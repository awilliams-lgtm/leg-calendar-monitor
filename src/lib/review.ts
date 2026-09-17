import { officialHandledKey } from "@/lib/calendar";
import { MATCH_THRESHOLD, eventDateKey, scorePair } from "@/lib/match";

export type ReviewConfirmation = {
  state: string;
  officialSourceId: string;
  title: string;
  start: string;
  chamber?: string;
  status: "dismissed" | "irrelevant";
};

function chamberNorm(value?: string): string {
  const v = (value || "").toLowerCase();
  if (v.includes("house") || v === "h" || v.includes("assembly")) return "house";
  if (v.includes("senate") || v === "s") return "senate";
  if (v.includes("joint")) return "joint";
  return "";
}

function sameSlot(
  event: { start: string; chamber?: string },
  confirmed: ReviewConfirmation,
): boolean {
  const t1 = (event.start || "").slice(0, 16);
  const t2 = (confirmed.start || "").slice(0, 16);
  if (!t1 || t1.length < 16 || t1 !== t2) return false;
  const c1 = chamberNorm(event.chamber);
  const c2 = chamberNorm(confirmed.chamber);
  return !c1 || !c2 || c1 === c2;
}

export function reviewMatches(
  event: { state: string; sourceId?: string; title: string; start: string; chamber?: string },
  confirmed: ReviewConfirmation,
): boolean {
  if ((event.state || "").toUpperCase() !== (confirmed.state || "").toUpperCase()) return false;
  if (event.sourceId && event.sourceId === confirmed.officialSourceId) return true;
  if (!eventDateKey(event.start) || eventDateKey(event.start) !== eventDateKey(confirmed.start)) return false;
  if (sameSlot(event, confirmed)) return true;
  return (
    scorePair(
      { title: event.title, start: event.start, chamber: event.chamber },
      { title: confirmed.title, start: confirmed.start, chamber: confirmed.chamber },
    ) >= MATCH_THRESHOLD
  );
}

export function findReviewMatch<T extends ReviewConfirmation>(
  event: { state: string; sourceId?: string; title: string; start: string; chamber?: string },
  confirmed: T[],
): T | undefined {
  if (!confirmed.length) return undefined;
  const exact = confirmed.find(
    (row) =>
      (event.state || "").toUpperCase() === (row.state || "").toUpperCase() &&
      event.sourceId &&
      event.sourceId === row.officialSourceId,
  );
  if (exact) return exact;
  const day = eventDateKey(event.start);
  const state = (event.state || "").toUpperCase();
  const pool = confirmed.filter(
    (row) => (row.state || "").toUpperCase() === state && eventDateKey(row.start) === day,
  );
  return pool.find((row) => reviewMatches(event, row));
}

export function filterUnconfirmed<T extends { state: string; officialSourceId: string; title: string; start: string; chamber?: string }>(
  rows: T[],
  confirmed: ReviewConfirmation[],
): T[] {
  if (!confirmed.length) return rows;
  const exact = new Set(
    confirmed.map((row) => officialHandledKey(row.state, row.officialSourceId)),
  );
  const byDay = new Map<string, ReviewConfirmation[]>();
  for (const row of confirmed) {
    const day = eventDateKey(row.start);
    if (!day) continue;
    const key = `${row.state.toUpperCase()}|${day}`;
    const list = byDay.get(key) || [];
    list.push(row);
    byDay.set(key, list);
  }
  return rows.filter((row) => {
    if (exact.has(officialHandledKey(row.state, row.officialSourceId))) return false;
    const pool = byDay.get(`${row.state}|${eventDateKey(row.start)}`) || [];
    return !findReviewMatch(
      {
        state: row.state,
        sourceId: row.officialSourceId,
        title: row.title,
        start: row.start,
        chamber: row.chamber,
      },
      pool,
    );
  });
}

export function expandReviewKeys(
  confirmed: ReviewConfirmation[],
  official: Array<{ state: string; sourceId: string; title: string; start: string; chamber?: string }>,
): Set<string> {
  const keys = new Set<string>();
  for (const row of confirmed) keys.add(officialHandledKey(row.state, row.officialSourceId));
  if (!confirmed.length || !official?.length) return keys;
  const byDay = new Map<string, ReviewConfirmation[]>();
  for (const row of confirmed) {
    const day = eventDateKey(row.start);
    if (!day) continue;
    const bucket = `${row.state.toUpperCase()}|${day}`;
    const list = byDay.get(bucket) || [];
    list.push(row);
    byDay.set(bucket, list);
  }
  for (const ev of official) {
    const key = officialHandledKey(ev.state, ev.sourceId);
    if (keys.has(key)) continue;
    const pool = byDay.get(`${(ev.state || "").toUpperCase()}|${eventDateKey(ev.start)}`) || [];
    if (pool.length && findReviewMatch(ev, pool)) keys.add(key);
  }
  return keys;
}
