import { toCalendarItems } from "@/lib/calendar";
import { eventDay, monthBounds } from "@/lib/dates";
import { databaseUrl } from "@/lib/db";
import { expandReviewKeysFor, loadReviewOfficialKeys } from "@/lib/handled";
import { loadOfficialCache } from "@/lib/official-cache";
import { loadSaCache, saByStateMap } from "@/lib/sa-cache";
import { chamberBucket, STATE_SOURCES } from "@/lib/states";
import { usableOfficialEvents, usableSaEvents } from "@/lib/title";
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

function payloadFromEvents(
  month: string,
  officialEvents: CalendarEvent[],
  saEvents: CalendarEvent[],
  handled: Set<string>,
  irrelevant: Set<string>,
  months: string[],
  officialUpdatedAt: string,
  saUpdatedAt: string,
): AnalyticsPayload {
  const useAll = month === "all";
  const officialSrc = useAll
    ? usableOfficialEvents(officialEvents)
    : usableOfficialEvents(officialEvents).filter((e) => e.start.slice(0, 7) === month);
  const saSrc = usableSaEvents(useAll ? saEvents : saEvents.filter((e) => e.start.slice(0, 7) === month));
  const saByState = saByStateMap(saEvents);

  const official: AnalyticsOfficial[] = [];
  for (const src of STATE_SOURCES) {
    const rows = officialSrc.filter((e) => e.state === src.code);
    if (!rows.length) continue;
    const sa = saByState.get(src.code) || [];
    const items = toCalendarItems(rows, sa, handled, irrelevant);
    for (const item of items) {
      if (item.irrelevant) continue;
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

  return {
    ok: true,
    month,
    label: useAll ? "All cached dates" : monthBounds(month).label,
    months,
    officialUpdatedAt,
    saUpdatedAt,
    saConnected: saEvents.length > 0,
    official,
    sa,
    states: STATE_SOURCES.map((s) => ({ code: s.code, name: s.name })),
  };
}

export async function buildAnalytics(month: string): Promise<AnalyticsPayload> {
  if (databaseUrl()) {
    const { calendarFeedStats, eventMonthKeys, eventsInRange } = await import("@/lib/data");
    const useAll = month === "all";
    const { official, sa } = await eventsInRange(useAll ? undefined : month);
    const months = await eventMonthKeys();
    const feed = await calendarFeedStats();
    const review = await loadReviewOfficialKeys();
    const keys = expandReviewKeysFor(review, official);
    return payloadFromEvents(
      month,
      official,
      sa,
      keys.handled,
      keys.irrelevant,
      months,
      feed.officialUpdatedAt,
      feed.saUpdatedAt,
    );
  }

  const [officialCache, saCache, review] = await Promise.all([
    loadOfficialCache(),
    loadSaCache(),
    loadReviewOfficialKeys(),
  ]);
  const officialSrc = usableOfficialEvents(officialCache.events);
  const keys = expandReviewKeysFor(
    review,
    month === "all" ? officialSrc : officialSrc.filter((e) => e.start.slice(0, 7) === month),
  );
  return payloadFromEvents(
    month,
    officialCache.events,
    saCache.events,
    keys.handled,
    keys.irrelevant,
    monthsFrom([...officialCache.events, ...saCache.events]),
    officialCache.updatedAt,
    saCache.updatedAt,
  );
}
