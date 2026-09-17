import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { toCalendarItems, inMonth } from "@/lib/calendar";
import { cacheFile } from "@/lib/cache-path";
import { MATCH_THRESHOLD, bestMatch } from "@/lib/match";
import { loadOfficialCache } from "@/lib/official-cache";
import { findReviewMatch, type ReviewConfirmation } from "@/lib/review";
import { loadSaCache } from "@/lib/sa-cache";
import { usableOfficialEvents } from "@/lib/title";
import type { GapRow } from "@/lib/types";

const DISMISS_FILE = cacheFile("dismissed-gaps.json");
const IRRELEVANT_FILE = cacheFile("irrelevant-gaps.json");

export type ReviewGapStatus = "open" | "dismissed" | "irrelevant";

type StoredReview = {
  keys?: string[];
  items?: Array<{
    state?: string;
    sourceId?: string;
    title?: string;
    start?: string;
    chamber?: string;
  }>;
};

export function gapKey(state: string, sourceId: string): string {
  return `${state}|${sourceId}`;
}

function stableId(state: string, sourceId: string): number {
  const s = gapKey(state, sourceId);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

function itemsFromStored(parsed: StoredReview, status: "dismissed" | "irrelevant"): ReviewConfirmation[] {
  const items = (parsed.items || [])
    .filter((row) => row.state && row.sourceId)
    .map((row) => ({
      state: String(row.state),
      officialSourceId: String(row.sourceId),
      title: String(row.title || ""),
      start: String(row.start || ""),
      chamber: String(row.chamber || ""),
      status,
    }));
  if (items.length) return items;
  return (parsed.keys || []).map((key) => {
    const cut = key.indexOf("|");
    return {
      state: cut === -1 ? "" : key.slice(0, cut),
      officialSourceId: cut === -1 ? key : key.slice(cut + 1),
      title: "",
      start: "",
      chamber: "",
      status,
    };
  });
}

async function loadReviewFile(file: string, status: "dismissed" | "irrelevant"): Promise<ReviewConfirmation[]> {
  try {
    const raw = await readFile(file, "utf8");
    return itemsFromStored(JSON.parse(raw) as StoredReview, status);
  } catch {
    return [];
  }
}

async function saveReviewFile(file: string, items: ReviewConfirmation[]) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify(
      {
        keys: items.map((row) => gapKey(row.state, row.officialSourceId)),
        items: items.map((row) => ({
          state: row.state,
          sourceId: row.officialSourceId,
          title: row.title,
          start: row.start,
          chamber: row.chamber || "",
        })),
      },
      null,
      2,
    ),
    "utf8",
  );
}

export async function loadDismissedConfirmations(): Promise<ReviewConfirmation[]> {
  return loadReviewFile(DISMISS_FILE, "dismissed");
}

export async function loadIrrelevantConfirmations(): Promise<ReviewConfirmation[]> {
  return loadReviewFile(IRRELEVANT_FILE, "irrelevant");
}

export async function loadDismissedGapKeys(): Promise<Set<string>> {
  const items = await loadDismissedConfirmations();
  return new Set(items.map((row) => gapKey(row.state, row.officialSourceId)));
}

export async function loadIrrelevantGapKeys(): Promise<Set<string>> {
  const items = await loadIrrelevantConfirmations();
  return new Set(items.map((row) => gapKey(row.state, row.officialSourceId)));
}

function confirmedForEvent(
  ev: { state: string; sourceId: string; title: string; start: string; chamber?: string },
  dismissed: ReviewConfirmation[],
  irrelevant: ReviewConfirmation[],
): ReviewConfirmation | undefined {
  return findReviewMatch(ev, dismissed) || findReviewMatch(ev, irrelevant);
}

export async function listCachedGaps(opts: {
  state?: string;
  month?: string;
  status?: string;
}): Promise<GapRow[]> {
  const status = opts.status || "open";
  const [official, saCache, dismissed, irrelevant] = await Promise.all([
    loadOfficialCache(),
    loadSaCache(),
    loadDismissedConfirmations(),
    loadIrrelevantConfirmations(),
  ]);
  let events = usableOfficialEvents(official.events);
  if (opts.state) events = events.filter((e) => e.state === opts.state);
  if (opts.month) events = events.filter((e) => inMonth(e.start, opts.month!));

  const saByState = new Map<string, typeof saCache.events>();
  for (const ev of saCache.events) {
    const list = saByState.get(ev.state) || [];
    list.push(ev);
    saByState.set(ev.state, list);
  }

  const gaps: GapRow[] = [];
  for (const ev of events) {
    const hit = confirmedForEvent(ev, dismissed, irrelevant);
    if (status === "irrelevant") {
      if (hit?.status !== "irrelevant") continue;
    } else if (hit) {
      continue;
    }
    const sa = saByState.get(ev.state) || [];
    const match = bestMatch(ev, sa);
    if (status !== "irrelevant" && match.score >= MATCH_THRESHOLD) continue;
    const item = toCalendarItems([ev], sa)[0];
    gaps.push({
      id: stableId(ev.state, ev.sourceId),
      state: ev.state,
      officialSourceId: ev.sourceId,
      title: ev.title,
      start: ev.start,
      location: ev.location || "",
      chamber: ev.chamber || "",
      url: ev.url || "",
      bills: item.bills || ev.bills || [],
      description: ev.description || "",
      status: status === "irrelevant" ? "irrelevant" : "open",
      score: match.score,
      createdAt: "",
      saMatchTitle: item.saMatchTitle,
    });
  }
  gaps.sort((a, b) => a.start.localeCompare(b.start) || a.state.localeCompare(b.state));
  return gaps;
}

export async function dismissCachedGap(opts: {
  id?: number;
  state?: string;
  officialSourceId?: string;
  title?: string;
  start?: string;
  chamber?: string;
}) {
  return setCachedGapStatus("dismissed", opts);
}

export async function setCachedGapStatus(
  status: ReviewGapStatus,
  opts: {
    id?: number;
    state?: string;
    officialSourceId?: string;
    title?: string;
    start?: string;
    chamber?: string;
  },
) {
  const [dismissed, irrelevant, cache] = await Promise.all([
    loadDismissedConfirmations(),
    loadIrrelevantConfirmations(),
    loadOfficialCache(),
  ]);
  let state = opts.state || "";
  let sourceId = opts.officialSourceId || "";
  if ((!state || !sourceId) && opts.id) {
    const hit = cache.events.find((ev) => stableId(ev.state, ev.sourceId) === opts.id);
    if (hit) {
      state = hit.state;
      sourceId = hit.sourceId;
    }
  }
  if (!state || !sourceId) return;
  const ev = cache.events.find((row) => row.state === state && row.sourceId === sourceId);
  const next: ReviewConfirmation = {
    state,
    officialSourceId: sourceId,
    title: opts.title || ev?.title || "",
    start: opts.start || ev?.start || "",
    chamber: opts.chamber || ev?.chamber || "",
    status: status === "open" ? "dismissed" : status,
  };
  const keep = (rows: ReviewConfirmation[]) =>
    rows.filter((row) => !(row.state === state && row.officialSourceId === sourceId) && !findReviewMatch(next, [row]));
  let nextDismissed = keep(dismissed);
  let nextIrrelevant = keep(irrelevant);
  if (status === "dismissed") nextDismissed = [...nextDismissed, { ...next, status: "dismissed" }];
  if (status === "irrelevant") nextIrrelevant = [...nextIrrelevant, { ...next, status: "irrelevant" }];
  await Promise.all([saveReviewFile(DISMISS_FILE, nextDismissed), saveReviewFile(IRRELEVANT_FILE, nextIrrelevant)]);
}
