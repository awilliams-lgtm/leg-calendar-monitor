import { mkdir, readFile, rename, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { cacheFile } from "@/lib/cache-path";
import { eventDay } from "@/lib/dates";
import { databaseUrl } from "@/lib/db";
import { isHiddenMeeting } from "@/lib/hidden";
import type { CalendarEvent } from "@/lib/types";

export type SaCache = {
  updatedAt: string;
  scraping: boolean;
  scraped: string[];
  events: CalendarEvent[];
  needsBrowserFetch: boolean;
  error: string;
};

const FILE = cacheFile("sa-meetings-cache.json");
const STALE_MS = 2 * 60 * 60 * 1000;
let memory: SaCache | null = null;
let memoryMtime = 0;

export function emptySaCache(): SaCache {
  return {
    updatedAt: "",
    scraping: false,
    scraped: [],
    events: [],
    needsBrowserFetch: false,
    error: "",
  };
}

export async function loadSaCache(): Promise<SaCache> {
  try {
    const info = await stat(FILE);
    if (memory && info.mtimeMs <= memoryMtime) return memory;
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<SaCache>;
    memory = {
      ...emptySaCache(),
      ...parsed,
      events: (parsed.events || []).filter((e) => !isHiddenMeeting(e)),
      scraped: parsed.scraped || [],
      scraping: false,
      needsBrowserFetch: Boolean(parsed.needsBrowserFetch),
      error: parsed.error || "",
    };
    memoryMtime = info.mtimeMs;
    return memory;
  } catch {
    if (memory) return memory;
    const fromDb = await hydrateSaFromDb();
    if (fromDb) {
      memory = fromDb;
      return memory;
    }
    memory = emptySaCache();
    return memory;
  }
}

async function hydrateSaFromDb(): Promise<SaCache | null> {
  if (!databaseUrl()) return null;
  try {
    const { allEventsForSource } = await import("@/lib/data");
    const events = (await allEventsForSource("sa")).filter((e) => !isHiddenMeeting(e));
    if (!events.length) return null;
    return {
      updatedAt: new Date().toISOString(),
      scraping: false,
      scraped: [...new Set(events.map((e) => e.state))],
      events,
      needsBrowserFetch: false,
      error: "",
    };
  } catch {
    return null;
  }
}

export async function saveSaCache(next: SaCache) {
  memory = next;
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(next), "utf8");
  try {
    await rename(tmp, FILE);
  } catch {
    await unlink(FILE).catch(() => undefined);
    await rename(tmp, FILE);
  }
  try {
    memoryMtime = (await stat(FILE)).mtimeMs;
  } catch {
    memoryMtime = Date.now();
  }
}

export function saByStateMap(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const list = map.get(ev.state) || [];
    list.push(ev);
    map.set(ev.state, list);
  }
  return map;
}

export function saCacheStale(cache: SaCache, maxAgeMs = STALE_MS): boolean {
  if (!cache.updatedAt && cache.scraped.length === 0) return true;
  if (!cache.updatedAt) return false;
  const t = Date.parse(cache.updatedAt);
  return !t || Date.now() - t > maxAgeMs;
}

export async function mergeSaUpcoming(
  state: string,
  events: CalendarEvent[],
  fromDay: string,
  toDay?: string,
  opts?: { replaceEmpty?: boolean },
) {
  const cache = await loadSaCache();
  const incoming = events.filter((e) => e.title && e.start && e.sourceId && !isHiddenMeeting(e));
  const existing = cache.events.filter((e) => e.state === state);
  const inWindow = (e: CalendarEvent) => {
    const day = eventDay(e.start);
    if (!day || day < fromDay) return false;
    if (toDay && day > toDay) return false;
    return true;
  };
  if (incoming.length || opts?.replaceEmpty) {
    const kept = existing.filter((e) => !inWindow(e));
    cache.events = cache.events.filter((e) => e.state !== state);
    cache.events.push(...kept, ...incoming);
  }
  if (!cache.scraped.includes(state)) cache.scraped.push(state);
  cache.updatedAt = new Date().toISOString();
  cache.error = "";
  await saveSaCache(cache);
  if (databaseUrl() && (incoming.length || opts?.replaceEmpty)) {
    try {
      const { upsertEvents } = await import("@/lib/data");
      await upsertEvents("sa", state, incoming);
    } catch {
      /* file cache is enough locally */
    }
  }
  return cache;
}

export async function replaceSaEvents(state: string, events: CalendarEvent[], opts?: { keepIfEmpty?: boolean }) {
  const cache = await loadSaCache();
  const existing = cache.events.filter((e) => e.state === state);
  const incoming = events.filter((e) => e.title && e.start && e.sourceId && !isHiddenMeeting(e));
  const nextEvents = incoming.length || !opts?.keepIfEmpty ? incoming : existing;
  cache.events = cache.events.filter((e) => e.state !== state);
  cache.events.push(...nextEvents);
  if (!cache.scraped.includes(state)) cache.scraped.push(state);
  cache.updatedAt = new Date().toISOString();
  cache.error = "";
  await saveSaCache(cache);
  return cache;
}

export async function mergeSaEvents(events: CalendarEvent[], scrapedStates: string[] = []) {
  const states = [
    ...new Set([...events.map((e) => e.state), ...scrapedStates].map((s) => String(s || "").toUpperCase()).filter(Boolean)),
  ];
  const cache = await loadSaCache();
  cache.events = cache.events.filter((e) => !states.includes(e.state));
  cache.events.push(...events.filter((e) => e.title && e.start && e.sourceId && !isHiddenMeeting(e)));
  for (const state of states) {
    if (!cache.scraped.includes(state)) cache.scraped.push(state);
  }
  cache.updatedAt = new Date().toISOString();
  cache.error = "";
  cache.needsBrowserFetch = false;
  await saveSaCache(cache);
  return cache;
}

export async function markSaBrowserFetch(error: string) {
  const cache = await loadSaCache();
  cache.needsBrowserFetch = true;
  cache.error = error;
  cache.scraping = false;
  await saveSaCache(cache);
  return cache;
}
