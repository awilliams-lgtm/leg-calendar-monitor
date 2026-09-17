import { NextRequest, NextResponse } from "next/server";
import { fetchSaUpcoming, saConfigured, saStateIdMap } from "@/lib/adapters/state-affairs";
import { dayCountsFromLists, inMonth, toCalendarItems } from "@/lib/calendar";
import { usableSaEvents } from "@/lib/title";
import { listCalendar } from "@/lib/data";
import { monthBounds, parseMonth, upcomingWindow } from "@/lib/dates";
import { databaseUrl } from "@/lib/db";
import { loadHandledOfficialKeys, loadIrrelevantOfficialKeys } from "@/lib/handled";
import { loadOfficialCache, replaceStateEvents } from "@/lib/official-cache";
import { loadSaCache, mergeSaUpcoming, saByStateMap } from "@/lib/sa-cache";
import { stateByCode } from "@/lib/states";
import { officialEventsFor } from "@/lib/sync";
import type { CalendarEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function slimSa(events: CalendarEvent[]) {
  return events.map((ev) => ({
    sourceId: ev.sourceId,
    state: ev.state,
    title: ev.title,
    start: ev.start,
    location: ev.location || "",
    chamber: ev.chamber || "",
    url: ev.url || "",
  }));
}

async function saForState(code: string, live: boolean): Promise<{ events: CalendarEvent[]; note: string }> {
  if (databaseUrl() && !live) {
    try {
      const { eventsForState } = await import("@/lib/data");
      return { events: await eventsForState("sa", code), note: "" };
    } catch {
      /* fall through to file cache */
    }
  }
  const cache = await loadSaCache();
  const cached = cache.events?.filter((e) => e.state === code) || [];
  if (cached.length || cache.scraped.includes(code) || !live) {
    return { events: cached, note: "" };
  }

  if (!(await saConfigured())) {
    return { events: [], note: "Connect State Affairs in Settings so everyone can see On SA vs Not on SA." };
  }
  try {
    const ids = await saStateIdMap();
    const stateId = ids.get(code);
    if (!stateId) return { events: [], note: "No State Affairs state id for this legislature." };
    const window = upcomingWindow();
    const liveEvents = await fetchSaUpcoming(code, stateId, window.from, window.to);
    await mergeSaUpcoming(code, liveEvents, window.from, window.to).catch(() => undefined);
    return { events: liveEvents, note: "" };
  } catch (err) {
    return { events: [], note: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get("state") || "").trim().toUpperCase();
  const src = stateByCode(code);
  if (!src) {
    return NextResponse.json({ ok: false, error: "Unknown state" }, { status: 404 });
  }

  const { key } = parseMonth(req.nextUrl.searchParams.get("month"));
  const { label } = monthBounds(key);
  const live = req.nextUrl.searchParams.get("live") === "1";

  const meta = {
    code: src.code,
    name: src.name,
    officialUrl: src.officialUrl,
    feeds: src.feeds.map((f) => ({ chamber: f.chamber, label: f.label, url: f.url })),
  };

  try {
    if (!live) {
      const sa = await saForState(code, false);
      const saMonth = usableSaEvents(sa.events).filter((e) => inMonth(e.start, key));
      if (databaseUrl()) {
        const items = await listCalendar(code, key);
        return NextResponse.json({
          ok: true,
          live: false,
          month: key,
          label,
          state: meta,
          items,
          saItems: slimSa(saMonth),
          days: dayCountsFromLists(items, saMonth),
          saNote: sa.note,
        });
      }
      const [handled, irrelevant] = await Promise.all([
        loadHandledOfficialKeys(),
        loadIrrelevantOfficialKeys(),
      ]);
      const cache = await loadOfficialCache();
      const cached = cache.events.filter((e) => e.state === code && inMonth(e.start, key));
      const items = toCalendarItems(cached, sa.events, handled, irrelevant).filter((ev) => !ev.irrelevant);
      return NextResponse.json({
        ok: true,
        live: false,
        month: key,
        label,
        state: meta,
        items,
        saItems: slimSa(saMonth),
        days: dayCountsFromLists(items, saMonth),
        saNote: sa.note,
      });
    }

    const [sa, handled, irrelevant] = await Promise.all([
      saForState(code, true),
      loadHandledOfficialKeys(),
      loadIrrelevantOfficialKeys(),
    ]);
    const saMonth = usableSaEvents(sa.events).filter((e) => inMonth(e.start, key));
    const pulled = await officialEventsFor(code);
    await replaceStateEvents(code, pulled.events, pulled.notes).catch(() => undefined);
    const items = toCalendarItems(pulled.events, sa.events, handled, irrelevant).filter(
      (ev) => inMonth(ev.start, key) && !ev.irrelevant,
    );
    return NextResponse.json({
      ok: true,
      live: true,
      month: key,
      label,
      state: meta,
      items,
      saItems: slimSa(saMonth),
      days: dayCountsFromLists(items, saMonth),
      notes: pulled.notes,
      saNote: sa.note,
    });
  } catch (err) {
    const saCache = await loadSaCache();
    const sa = saByStateMap(saCache.events).get(code) || [];
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        month: key,
        label,
        state: meta,
        saItems: slimSa(usableSaEvents(sa).filter((e) => inMonth(e.start, key))),
      },
      { status: 500 },
    );
  }
}
