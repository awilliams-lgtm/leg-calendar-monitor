import { MATCH_THRESHOLD, bestMatch, extractBills, type Matchable } from "@/lib/match";
import { STATE_SOURCES } from "@/lib/states";
import { eventDay } from "@/lib/dates";
import { isHiddenMeeting } from "@/lib/hidden";
import { usableOfficialEvents } from "@/lib/title";
import type { CalendarEvent, CalendarItem, DayCounts, StateMonthSummary } from "@/lib/types";

export function officialHandledKey(state: string, sourceId: string): string {
  return `${state}|${sourceId}`;
}

export function toCalendarItems(
  official: CalendarEvent[],
  sa: Matchable[],
  handled?: Set<string>,
): CalendarItem[] {
  return usableOfficialEvents(official).map((ev) => {
    const match = bestMatch(ev, sa);
    const matched = match.score >= MATCH_THRESHOLD;
    const wasHandled = Boolean(handled?.has(officialHandledKey(ev.state, ev.sourceId)));
    return {
      sourceId: ev.sourceId,
      state: ev.state,
      title: ev.title,
      start: ev.start,
      location: ev.location || "",
      chamber: ev.chamber || "",
      url: ev.url || "",
      bills: [...new Set([...(ev.bills || []), ...extractBills(`${ev.title}\n${ev.description || ""}`)])],
      description: ev.description || "",
      onSa: matched || wasHandled,
      handled: wasHandled,
      saMatchTitle: match.title,
    };
  });
}

export function inMonth(start: string, month: string): boolean {
  return start.slice(0, 7) === month;
}

export function dayCountsFromItems(items: CalendarItem[]): Record<string, DayCounts> {
  const days: Record<string, DayCounts> = {};
  for (const ev of items) {
    const d = eventDay(ev.start);
    if (!d) continue;
    if (!days[d]) days[d] = { onSa: 0, missing: 0, saMeetings: 0 };
    if (ev.onSa) days[d].onSa += 1;
    else days[d].missing += 1;
  }
  return days;
}

export function dayCountsFromLists(official: CalendarItem[], sa: CalendarEvent[]): Record<string, DayCounts> {
  const days = dayCountsFromItems(official);
  for (const ev of sa) {
    if (isHiddenMeeting(ev)) continue;
    const d = eventDay(ev.start);
    if (!d) continue;
    if (!days[d]) days[d] = { onSa: 0, missing: 0, saMeetings: 0 };
    days[d].saMeetings += 1;
  }
  return days;
}

export function summarizeState(
  code: string,
  name: string,
  officialUrl: string,
  items: CalendarItem[],
  saMeetings = 0,
): StateMonthSummary {
  const days = dayCountsFromItems(items);
  let onSa = 0;
  let missing = 0;
  for (const ev of items) {
    if (ev.onSa) onSa += 1;
    else missing += 1;
  }
  return { code, name, officialUrl, days, onSa, missing, saMeetings };
}

export function emptyMonthSummaries(): StateMonthSummary[] {
  return STATE_SOURCES.map((s) => ({
    code: s.code,
    name: s.name,
    officialUrl: s.officialUrl,
    days: {},
    onSa: 0,
    missing: 0,
    saMeetings: 0,
  }));
}

export function summariesFromEvents(
  events: CalendarEvent[],
  month: string,
  saByState?: Map<string, Matchable[]>,
  handled?: Set<string>,
): StateMonthSummary[] {
  return STATE_SOURCES.map((src) => {
    const official = events.filter((e) => e.state === src.code && inMonth(e.start, month));
    const sa = saByState?.get(src.code) || [];
    const saMonth = sa.filter((e) => inMonth(e.start, month) && !isHiddenMeeting(e));
    return summarizeState(
      src.code,
      src.name,
      src.officialUrl,
      toCalendarItems(official, sa, handled),
      saMonth.length,
    );
  });
}
