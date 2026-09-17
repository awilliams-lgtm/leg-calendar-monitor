import { mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";
import { cacheFile } from "@/lib/cache-path";
import { databaseUrl, hostedDatabase } from "@/lib/db";
import { foldOfficialIncoming } from "@/lib/official-merge";
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
const META_KEY = "official_cache_meta";

let memory: OfficialCache | null = null;
let memoryMtime = 0;

export function emptyCache(): OfficialCache {
  return { updatedAt: "", scraping: false, scraped: [], events: [], notes: {}, lastPulled: {} };
}

export async function loadOfficialPullMeta(): Promise<{ scraping: boolean; scraped: string[]; updatedAt: string }> {
  if (hostedDatabase()) {
    try {
      const { getMeta } = await import("@/lib/data");
      const raw = await getMeta(META_KEY);
      if (raw) {
        const meta = JSON.parse(raw) as { scraped?: string[]; updatedAt?: string };
        return { scraping: false, scraped: meta.scraped || [], updatedAt: meta.updatedAt || "" };
      }
    } catch {
      /* fall through */
    }
  }
  const cache = await loadOfficialCache();
  return { scraping: cache.scraping, scraped: cache.scraped, updatedAt: cache.updatedAt };
}

export async function loadOfficialCache(): Promise<OfficialCache> {
  if (hostedDatabase()) {
    if (memory && memory.events?.length) {
      memory.events = usableOfficialEvents(memory.events);
      return memory;
    }
    const fromDb = await hydrateOfficialFromDb();
    if (fromDb) {
      memory = fromDb;
      return memory;
    }
  }
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

async function persistOfficialMeta(cache: OfficialCache) {
  if (!databaseUrl()) return;
  const { setMeta } = await import("@/lib/data");
  await setMeta(
    META_KEY,
    JSON.stringify({
      scraped: cache.scraped,
      lastPulled: cache.lastPulled || {},
      updatedAt: cache.updatedAt,
    }),
  );
}

async function hydrateOfficialFromDb(): Promise<OfficialCache | null> {
  if (!databaseUrl()) return null;
  try {
    const { allEventsForSource, getMeta } = await import("@/lib/data");
    const events = usableOfficialEvents(await allEventsForSource("official"));
    let meta: { scraped?: string[]; lastPulled?: Record<string, string>; updatedAt?: string } = {};
    try {
      const raw = await getMeta(META_KEY);
      if (raw) meta = JSON.parse(raw) as typeof meta;
    } catch {
      /* no meta yet */
    }
    const scraped = [...new Set([...(meta.scraped || []), ...events.map((e) => e.state)])];
    if (!events.length && !scraped.length) return null;
    return {
      updatedAt: meta.updatedAt || new Date().toISOString(),
      scraping: false,
      scraped,
      events,
      notes: {},
      lastPulled: meta.lastPulled || Object.fromEntries(scraped.map((code) => [code, new Date().toISOString()])),
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
  await persistOfficialMeta(next).catch(() => undefined);
}

export async function replaceStateEvents(state: string, events: CalendarEvent[], notes: string[]) {
  const cache = await loadOfficialCache();
  const existing = cache.events.filter((e) => e.state === state);
  cache.events = [...cache.events.filter((e) => e.state !== state), ...foldOfficialIncoming(existing, events)];
  cache.notes[state] = notes;
  cache.lastPulled = cache.lastPulled || {};
  cache.lastPulled[state] = new Date().toISOString();
  if (!cache.scraped.includes(state)) cache.scraped.push(state);
  cache.updatedAt = new Date().toISOString();
  await saveOfficialCache(cache);
  if (databaseUrl()) {
    try {
      const { replaceOfficialEvents } = await import("@/lib/data");
      await replaceOfficialEvents(state, events);
    } catch {
      /* file cache is enough locally */
    }
  }
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
