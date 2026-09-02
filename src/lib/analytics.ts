import { toCalendarItems } from "@/lib/calendar";
import { eventDay, monthBounds } from "@/lib/dates";
import { loadHandledOfficialKeys } from "@/lib/handled";
import { isHiddenMeeting } from "@/lib/hidden";
import { loadOfficialCache } from "@/lib/official-cache";
import { loadSaCache, saByStateMap } from "@/lib/sa-cache";
import { chamberBucket, STATE_SOURCES } from "@/lib/states";
import { usableOfficialEvents } from "@/lib/title";
import type { CalendarEvent } from "@/lib/types";

export type AnalyticsChamber = "house" | "senate" | "other";

export type AnalyticsOfficial = {
  state: string;
  chamber: AnalyticsChamber;
  onSa: boolean;
  day: string;
};

export type AnalyticsSa = {
  state: string;
  chamber: AnalyticsChamber;
  day: string;
};

export type AnalyticsPayload = {
  ok: true;
  month: string;
  label: string;
  months: string[];
  officialUpdatedAt: string;
  saUpdatedAt: string;
  saConnected: boolean;
  official: AnalyticsOfficial[];
  sa: AnalyticsSa[];
  states: { code: string; name: string }[];
};

function monthsFrom(events: CalendarEvent[]): string[] {
  const set = new Set<string>();
  for (const ev of events) {
    const m = (ev.start || "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(m)) set.add(m);
  }
  return [...set].sort().reverse();
}

export async function buildAnalytics(month: string): Promise<AnalyticsPayload> {
  const [officialCache, saCache, handled] = await Promise.all([
    loadOfficialCache(),
    loadSaCache(),
    loadHandledOfficialKeys(),
  ]);
  const allMonths = monthsFrom([...officialCache.events, ...saCache.events]);
  const useAll = month === "all";
  const officialSrc = useAll
    ? usableOfficialEvents(officialCache.events)
    : usableOfficialEvents(officialCache.events).filter((e) => e.start.slice(0, 7) === month);
  const saSrc = (useAll ? saCache.events : saCache.events.filter((e) => e.start.slice(0, 7) === month)).filter(
    (e) => !isHiddenMeeting(e),
  );
  const saByState = saByStateMap(saCache.events);

  const official: AnalyticsOfficial[] = [];
  for (const src of STATE_SOURCES) {
    const rows = officialSrc.filter((e) => e.state === src.code);
    if (!rows.length) continue;
    const sa = saByState.get(src.code) || [];
    const items = toCalendarItems(rows, sa, handled);
    for (const item of items) {
      const day = eventDay(item.start);
      if (!day) continue;
      official.push({
        state: src.code,
        chamber: chamberBucket(item.chamber),
        onSa: item.onSa,
        day,
      });
    }
  }

  const sa: AnalyticsSa[] = saSrc
    .map((ev) => ({
      state: ev.state,
      chamber: chamberBucket(ev.chamber),
      day: eventDay(ev.start),
    }))
    .filter((ev) => /^\d{4}-\d{2}-\d{2}$/.test(ev.day));

  const label = useAll ? "All cached dates" : monthBounds(month).label;

  return {
    ok: true,
    month,
    label,
    months: allMonths,
    officialUpdatedAt: officialCache.updatedAt,
    saUpdatedAt: saCache.updatedAt,
    saConnected: saCache.events.length > 0,
    official,
    sa,
    states: STATE_SOURCES.map((s) => ({ code: s.code, name: s.name })),
  };
}
