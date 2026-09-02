import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { toCalendarItems, inMonth } from "@/lib/calendar";
import { cacheFile } from "@/lib/cache-path";
import { MATCH_THRESHOLD, bestMatch } from "@/lib/match";
import { loadOfficialCache } from "@/lib/official-cache";
import { loadSaCache } from "@/lib/sa-cache";
import { usableOfficialEvents } from "@/lib/title";
import type { GapRow } from "@/lib/types";

const DISMISS_FILE = cacheFile("dismissed-gaps.json");

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

export async function loadDismissedGapKeys(): Promise<Set<string>> {
  try {
    const raw = await readFile(DISMISS_FILE, "utf8");
    const parsed = JSON.parse(raw) as { keys?: string[] };
    return new Set(parsed.keys || []);
  } catch {
    return new Set();
  }
}

async function saveDismissed(keys: Set<string>) {
  await mkdir(path.dirname(DISMISS_FILE), { recursive: true });
  await writeFile(DISMISS_FILE, JSON.stringify({ keys: [...keys] }, null, 2), "utf8");
}

export async function listCachedGaps(opts: { state?: string; month?: string }): Promise<GapRow[]> {
  const [official, saCache, dismissed] = await Promise.all([loadOfficialCache(), loadSaCache(), loadDismissedGapKeys()]);
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
    if (dismissed.has(gapKey(ev.state, ev.sourceId))) continue;
    const sa = saByState.get(ev.state) || [];
    const match = bestMatch(ev, sa);
    if (match.score >= MATCH_THRESHOLD) continue;
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
      status: "open",
      score: match.score,
      createdAt: "",
      saMatchTitle: item.saMatchTitle,
    });
  }
  gaps.sort((a, b) => a.start.localeCompare(b.start) || a.state.localeCompare(b.state));
  return gaps;
}

export async function dismissCachedGap(opts: { id?: number; state?: string; officialSourceId?: string }) {
  return setCachedGapStatus("dismissed", opts);
}

export async function setCachedGapStatus(
  status: "open" | "dismissed",
  opts: { id?: number; state?: string; officialSourceId?: string },
) {
  const keys = await loadDismissedGapKeys();
  let key = opts.state && opts.officialSourceId ? gapKey(opts.state, opts.officialSourceId) : "";
  if (!key && opts.id) {
    const gaps = await listCachedGaps({});
    const hit = gaps.find((g) => g.id === opts.id);
    if (hit) key = gapKey(hit.state, hit.officialSourceId);
  }
  if (!key) return;
  if (status === "dismissed") keys.add(key);
  else keys.delete(key);
  await saveDismissed(keys);
}
