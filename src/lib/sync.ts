import { fetchOfficialEvents } from "@/lib/adapters/official";
import { fetchOpenStatesEvents } from "@/lib/adapters/openstates";
import { replaceStateEvents } from "@/lib/official-cache";
import {
  compareState,
  eventsForState,
  insertNotification,
  recordSyncRun,
  upsertEvents,
} from "@/lib/data";
import { formatGapAlert, notifyEmail, notifySlack } from "@/lib/notify";
import { STATE_SOURCES, stateByCode } from "@/lib/states";
import type { CalendarEvent, SyncResult } from "@/lib/types";
import { databaseUrl } from "@/lib/db";

function afterIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 2);
  return d.toISOString();
}

export async function officialEventsFor(code: string): Promise<{ events: CalendarEvent[]; notes: string[] }> {
  const src = stateByCode(code);
  if (!src) throw new Error(`Unknown state ${code}`);
  const collected: CalendarEvent[] = [];
  const notes: string[] = [];

  const official = await fetchOfficialEvents(src);
  collected.push(...official.events);
  notes.push(...official.notes);

  if (src.icsUrl) {
    try {
      const { fetchIcsEvents } = await import("@/lib/adapters/ics");
      const { upcomingWindow } = await import("@/lib/dates");
      const window = upcomingWindow();
      const lookback = new Date();
      lookback.setDate(lookback.getDate() - 14);
      const from = lookback.toISOString().slice(0, 10);
      const ics = (await fetchIcsEvents(src.icsUrl)).filter((e) => {
        const day = (e.start || "").slice(0, 10);
        return day >= from && day <= window.to;
      });
      collected.push(...ics.map((e) => ({ ...e, state: code })));
      notes.push(`${code} ics → ${ics.length}`);
    } catch (err) {
      notes.push(`${code} ics failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const vaIcsStale = src.code === "VA" && !collected.some((e) => (e.url || "").includes("liscdn"));
  const needOpenStates =
    Boolean(process.env.OPENSTATES_API_KEY?.trim()) && (collected.length === 0 || vaIcsStale);
  if (needOpenStates) {
    try {
      const os = await fetchOpenStatesEvents(src.openstates, afterIso());
      collected.push(...os.map((e) => ({ ...e, state: code })));
      notes.push(`${code} openstates → ${os.length}`);
    } catch (err) {
      notes.push(`${code} openstates failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const seen = new Set<string>();
  const events = collected.filter((e) => {
    const id = e.sourceId || `${e.start}|${e.title}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { events, notes };
}

async function emit(kind: "new_official" | "missing_on_sa", ev: CalendarEvent, state: string) {
  const created = await insertNotification({
    kind,
    state,
    sourceId: ev.sourceId,
    title: ev.title,
    start: ev.start,
    url: ev.url || "",
  });
  if (!created) return;
  const msg = formatGapAlert({ kind, state, title: ev.title, start: ev.start, url: ev.url });
  await Promise.allSettled([notifySlack(msg.slack), notifyEmail(msg.subject, msg.html)]);
}

export async function syncState(code: string): Promise<SyncResult> {
  const state = code.toUpperCase();
  const result: SyncResult = {
    state,
    officialUpserted: 0,
    saUpserted: 0,
    newOfficial: 0,
    newGaps: 0,
  };

  try {
    const pulled = await officialEventsFor(state);
    result.notes = pulled.notes;
    const official = pulled.events;
    await replaceStateEvents(state, official, pulled.notes).catch(() => undefined);
    const off = await upsertEvents("official", state, official);
    result.officialUpserted = off.upserted;
    result.newOfficial = off.newIds.length;
    await recordSyncRun(state, "official", off.upserted);
    const officialById = new Map(official.map((e) => [e.sourceId, e]));
    for (const id of off.newIds) {
      const ev = officialById.get(id);
      if (ev) await emit("new_official", ev, state);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = message;
    await recordSyncRun(state, "official", 0, message);
  }

  if (databaseUrl()) {
    const compared = await compareState(state);
    result.newGaps = compared.newGaps;

    if (compared.newGaps) {
      const official = await eventsForState("official", state);
      const byId = new Map(official.map((e) => [e.sourceId, e]));
      const { listGaps } = await import("@/lib/data");
      const gaps = await listGaps({ state, status: "open", limit: 50 });
      for (const gap of gaps.slice(0, compared.newGaps + 5)) {
        const ev = byId.get(gap.officialSourceId);
        if (ev) {
          await emit("missing_on_sa", { ...ev, state, bills: ev.bills }, state);
        }
      }
    }
  }

  return result;
}

export function nextBatch(cursor: number, size: number): { codes: string[]; nextCursor: number } {
  const n = STATE_SOURCES.length;
  const codes: string[] = [];
  let i = cursor % n;
  for (let k = 0; k < Math.min(size, n); k += 1) {
    codes.push(STATE_SOURCES[i].code);
    i = (i + 1) % n;
  }
  return { codes, nextCursor: i };
}
