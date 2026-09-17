import { MATCH_THRESHOLD, bestMatchEvent, extractBills } from "@/lib/match";
import { completeOfficialTitle, isGenericCommitteeLabel, junkOfficialEvent } from "@/lib/title";
import type { CalendarEvent } from "@/lib/types";

function richerText(incoming?: string, existing?: string): string {
  const next = String(incoming || "").trim();
  const prev = String(existing || "").trim();
  if (!next) return prev;
  if (!prev) return next;
  return next.length >= prev.length ? next : prev;
}

function withoutStandingCategory(title: string): string {
  return title
    .replace(/\s+standing\s+committee\s*$/i, " Committee")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function officialSlotKey(ev: CalendarEvent): string {
  return `${(ev.state || "").toUpperCase()}|${(ev.chamber || "").toLowerCase()}|${(ev.start || "").slice(0, 16)}`;
}

function pickOfficialTitle(incoming?: string, existing?: string): string {
  const next = String(incoming || "").trim();
  const prev = String(existing || "").trim();
  if (!next) return prev;
  if (!prev) return next;
  if (isGenericCommitteeLabel(prev) && !isGenericCommitteeLabel(next)) return next;
  if (isGenericCommitteeLabel(next) && !isGenericCommitteeLabel(prev)) return prev;
  const prevStanding = /\bstanding committee\b/i.test(prev);
  const nextStanding = /\bstanding committee\b/i.test(next);
  if (prevStanding && !nextStanding) return next;
  if (nextStanding && !prevStanding) return prev;
  return richerText(next, prev);
}

function richerStart(incoming?: string, existing?: string): string {
  const next = String(incoming || "").trim();
  const prev = String(existing || "").trim();
  if (!next) return prev;
  if (!prev) return next;
  const nextTime = next.slice(11, 16);
  const prevTime = prev.slice(11, 16);
  const nextHasTime = Boolean(nextTime && nextTime !== "00:00");
  const prevHasTime = Boolean(prevTime && prevTime !== "00:00");
  if (nextHasTime && !prevHasTime) return next;
  if (prevHasTime && !nextHasTime) return prev;
  return next;
}

export function mergeOfficialEvent(existing: CalendarEvent, incoming: CalendarEvent): CalendarEvent {
  const bills = [
    ...new Set([
      ...(existing.bills || []),
      ...(incoming.bills || []),
      ...extractBills(`${incoming.title}\n${incoming.description || ""}`),
      ...extractBills(`${existing.title}\n${existing.description || ""}`),
    ]),
  ].sort();
  return {
    ...existing,
    title: pickOfficialTitle(
      completeOfficialTitle(incoming.title, incoming.location, incoming.description),
      completeOfficialTitle(existing.title, existing.location, existing.description),
    ),
    start: richerStart(incoming.start, existing.start),
    end: richerText(incoming.end, existing.end) || existing.end,
    allDay: incoming.allDay ?? existing.allDay,
    location: richerText(incoming.location, existing.location),
    chamber: incoming.chamber || existing.chamber,
    url: richerText(incoming.url, existing.url),
    bills,
    description: richerText(incoming.description, existing.description),
    raw: incoming.raw ?? existing.raw,
  };
}

/** Keep every stored official meeting. Same-day matches update in place. */
export function foldOfficialIncoming(existing: CalendarEvent[], incoming: CalendarEvent[]): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  for (const ev of existing) {
    if (!ev.sourceId || junkOfficialEvent(ev)) continue;
    byId.set(ev.sourceId, { ...ev, bills: ev.bills || [] });
  }
  const claimed = new Set<string>();
  for (const raw of incoming) {
    if (!raw.sourceId || !raw.title || !raw.start) continue;
    const incomingEvent = { ...raw, bills: raw.bills || [] };
    if (byId.has(incomingEvent.sourceId)) {
      byId.set(incomingEvent.sourceId, mergeOfficialEvent(byId.get(incomingEvent.sourceId)!, incomingEvent));
      claimed.add(incomingEvent.sourceId);
      continue;
    }
    const pool = [...byId.values()].filter((ev) => !claimed.has(ev.sourceId));
    const incomingSlot = officialSlotKey(incomingEvent);
    const slotHit = pool.find((ev) => {
      if (officialSlotKey(ev) !== incomingSlot) return false;
      return (
        isGenericCommitteeLabel(ev.title) ||
        isGenericCommitteeLabel(incomingEvent.title) ||
        withoutStandingCategory(ev.title) === withoutStandingCategory(incomingEvent.title)
      );
    });
    if (slotHit) {
      byId.set(slotHit.sourceId, mergeOfficialEvent(slotHit, incomingEvent));
      claimed.add(slotHit.sourceId);
      continue;
    }
    const hit = bestMatchEvent(incomingEvent, pool);
    if (hit.event && hit.score >= MATCH_THRESHOLD) {
      byId.set(hit.event.sourceId, mergeOfficialEvent(hit.event, incomingEvent));
      claimed.add(hit.event.sourceId);
      continue;
    }
    byId.set(incomingEvent.sourceId, incomingEvent);
    claimed.add(incomingEvent.sourceId);
  }
  return [...byId.values()];
}
