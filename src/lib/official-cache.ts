import { mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";
import { cacheFile } from "@/lib/cache-path";
import { databaseUrl } from "@/lib/db";
import { usableOfficialEvents } from "@/lib/title";
import type { CalendarEvent } from "@/lib/types";

export type OfficialCache = {
  updatedAt: string;
  scraping: boolean;
  scraped: string[];
  events: CalendarEvent[];
  notes: Record<string, string[]>;
  lastPulled?: Record<string, string>;
};

const FILE = cacheFile("official-cache.json");

let memory: OfficialCache | null = null;
let memoryMtime = 0;

export function emptyCache(): OfficialCache {
  return { updatedAt: "", scraping: false, scraped: [], events: [], notes: {}, lastPulled: {} };
}

export async function loadOfficialCache(): Promise<OfficialCache> {
  try {
    const info = await stat(FILE);
    if (memory && info.mtimeMs <= memoryMtime) {
      memory.events = usableOfficialEvents(memory.events);
      return memory;
    }
    const raw = await readFile(FILE, "utf8");
    memory = JSON.parse(raw) as OfficialCache;
    memory.events ||= [];
    memory.scraped ||= [];
    memory.lastPulled ||= {};
    memory.scraping = false;
    memory.events = usableOfficialEvents(memory.events);
    memoryMtime = info.mtimeMs;
    return memory;
  } catch {
    if (memory) {
      memory.events = usableOfficialEvents(memory.events);
      return memory;
    }
    const fromDb = await hydrateOfficialFromDb();
    if (fromDb) {
      memory = fromDb;
      return memory;
    }
    memory = emptyCache();
    return memory;
  }
}

async function hydrateOfficialFromDb(): Promise<OfficialCache | null> {
  if (!databaseUrl()) return null;
  try {
    const { allEventsForSource } = await import("@/lib/data");
    const events = usableOfficialEvents(await allEventsForSource("official"));
    if (!events.length) return null;
    const scraped = [...new Set(events.map((e) => e.state))];
    return {
      updatedAt: new Date().toISOString(),
      scraping: false,
      scraped,
      events,
      notes: {},
      lastPulled: Object.fromEntries(scraped.map((code) => [code, new Date().toISOString()])),
    };
  } catch {
    return null;
  }
}

export async function saveOfficialCache(next: OfficialCache) {
  memory = next;
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(next), "utf8");
  try {
    memoryMtime = (await stat(FILE)).mtimeMs;
  } catch {
    memoryMtime = Date.now();
  }
}

export async function replaceStateEvents(state: string, events: CalendarEvent[], notes: string[]) {
  const cache = await loadOfficialCache();
  cache.events = cache.events.filter((e) => e.state !== state);
  cache.events.push(...events);
  cache.notes[state] = notes;
  cache.lastPulled = cache.lastPulled || {};
  cache.lastPulled[state] = new Date().toISOString();
  if (!cache.scraped.includes(state)) cache.scraped.push(state);
  cache.updatedAt = new Date().toISOString();
  await saveOfficialCache(cache);
  return cache;
}

export async function mergeStateEvents(state: string, events: CalendarEvent[], notes: string[]) {
  const cache = await loadOfficialCache();
  const existing = cache.events.filter((e) => e.state === state);
  const seen = new Set(existing.map((e) => e.sourceId));
  const added = events.filter((e) => e.sourceId && !seen.has(e.sourceId));
  cache.events = [...cache.events.filter((e) => e.state !== state), ...existing, ...added];
  cache.notes[state] = [...(cache.notes[state] || []), ...notes];
  cache.lastPulled = cache.lastPulled || {};
  cache.lastPulled[state] = new Date().toISOString();
  if (!cache.scraped.includes(state)) cache.scraped.push(state);
  cache.updatedAt = new Date().toISOString();
  await saveOfficialCache(cache);
  return { cache, added: added.length, total: existing.length + added.length };
}

export function cacheIsStale(cache: OfficialCache, maxAgeMs = 6 * 60 * 60 * 1000): boolean {
  if (!cache.updatedAt || cache.events.length === 0) return true;
  const t = Date.parse(cache.updatedAt);
  return !t || Date.now() - t > maxAgeMs;
}

const PULL_STALE_MS = 12 * 60 * 60 * 1000;

export function statePullIsStale(cache: OfficialCache, code: string, maxAgeMs = PULL_STALE_MS): boolean {
  const t = Date.parse(cache.lastPulled?.[code] || "");
  return !t || Date.now() - t > maxAgeMs;
}
