import {
  clearSaAdminWindowCache,
  fetchSaAdminWindow,
  importCapturedSaMeetings,
  isSaBlocked,
  saConfigured,
} from "@/lib/adapters/state-affairs";
import { eventDay, upcomingWindow } from "@/lib/dates";
import { loadSaCache, markSaBrowserFetch, mergeSaUpcoming, saCacheStale, saveSaCache } from "@/lib/sa-cache";
import { STATE_SOURCES } from "@/lib/states";

export async function importCapturedWindow() {
  const window = upcomingWindow();
  const byState = await importCapturedSaMeetings(window.from, window.to);
  if (!byState) return null;
  for (const src of STATE_SOURCES) {
    await mergeSaUpcoming(src.code, byState.get(src.code) || [], window.from, window.to, { replaceEmpty: true });
  }
  return byState;
}

export async function refreshSaMeetings(states?: string[], opts?: { force?: boolean }) {
  if (!(await saConfigured())) {
    const cache = await loadSaCache();
    cache.scraping = false;
    await saveSaCache(cache);
    return { ...publicSa(cache), skipped: true, reason: "no-session" as const };
  }

  if (opts?.force) clearSaAdminWindowCache();

  const cache = await loadSaCache();
  const emptyFullPass = cache.scraped.length >= STATE_SOURCES.length && cache.events.length === 0;
  if (opts?.force && !states?.length) {
    cache.scraped = [];
    await saveSaCache(cache);
  } else if (!states?.length && (emptyFullPass || saCacheStale(cache))) {
    cache.scraped = [];
    await saveSaCache(cache);
  }
  const wanted = (states?.length ? states : STATE_SOURCES.map((s) => s.code)).map((s) => s.toUpperCase());
  if (states?.length) {
    cache.scraped = cache.scraped.filter((code) => !wanted.includes(code));
    await saveSaCache(cache);
  }
  const remaining = wanted.filter((code) => !cache.scraped.includes(code));
  cache.scraping = remaining.length > 0;
  await saveSaCache(cache);

  if (!remaining.length) {
    cache.scraping = false;
    await saveSaCache(cache);
    return { ...publicSa(cache), skipped: false };
  }

  const window = upcomingWindow();
  try {
    const byState = await fetchSaAdminWindow(window.from, window.to, remaining);
    for (const code of remaining) {
      await mergeSaUpcoming(code, byState.get(code) || [], window.from, window.to, { replaceEmpty: true });
    }
    try {
      const { compareState } = await import("@/lib/data");
      for (const code of remaining) {
        await compareState(code);
      }
    } catch {
      /* file cache is enough when the database is not configured */
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isSaBlocked(err)) {
      await markSaBrowserFetch(message);
      throw err;
    }
    throw err;
  }

  const next = await loadSaCache();
  next.scraping = false;
  next.needsBrowserFetch = false;
  next.error = "";
  await saveSaCache(next);
  return { ...publicSa(next), skipped: false };
}

export function publicSa(cache: Awaited<ReturnType<typeof loadSaCache>>) {
  const window = upcomingWindow();
  const upcoming = cache.events.filter((e) => {
    const day = eventDay(e.start);
    return day >= window.from && day <= window.to;
  }).length;
  return {
    updatedAt: cache.updatedAt,
    scraping: cache.scraping,
    scraped: cache.scraped.length,
    scrapedCodes: cache.scraped,
    total: STATE_SOURCES.length,
    events: cache.events.length,
    upcomingFrom: window.from,
    upcomingTo: window.to,
    upcoming,
    needsBrowserFetch: cache.needsBrowserFetch,
    error: cache.error,
  };
}
