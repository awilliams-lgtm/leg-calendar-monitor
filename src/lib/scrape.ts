import { loadOfficialCache, saveOfficialCache, statePullIsStale, type OfficialCache } from "@/lib/official-cache";
import { syncState } from "@/lib/sync";
import { STATE_SOURCES } from "@/lib/states";

const BATCH = 6;
const PRIORITY = ["US", "MA", "NC", "MD", "IA", "SC", "UT", "TX", "VA", "WA", "FL", "NY", "CA", "MN", "NJ", "CO", "OR", "WI", "PA", "OH", "IL"];

function scrapeOrder(wanted: string[]): string[] {
  const set = new Set(wanted);
  const first = PRIORITY.filter((code) => set.has(code));
  const rest = wanted.filter((code) => !PRIORITY.includes(code));
  return [...first, ...rest];
}

export async function scrapeBatch(states?: string[]): Promise<OfficialCache> {
  const cache = await loadOfficialCache();
  cache.lastPulled ||= {};
  const explicit = Boolean(states?.length);
  const wanted = scrapeOrder((states?.length ? states : STATE_SOURCES.map((s) => s.code)).map((s) => s.toUpperCase()));
  const remaining = explicit ? wanted : wanted.filter((code) => !cache.scraped.includes(code));
  const due = explicit ? [] : wanted.filter((code) => cache.scraped.includes(code) && statePullIsStale(cache, code));
  const queue = remaining.length ? remaining : due;
  const batch = queue.slice(0, BATCH);
  cache.scraping = queue.length > 0;
  await saveOfficialCache(cache);

  for (const code of batch) {
    await syncState(code);
  }

  const next = await loadOfficialCache();
  const stillUnscraped = wanted.filter((code) => !next.scraped.includes(code));
  const stillDue = explicit ? [] : wanted.filter((code) => statePullIsStale(next, code));
  next.scraping = stillUnscraped.length > 0 || stillDue.length > 0;
  await saveOfficialCache(next);
  return next;
}

export async function resetScrapeProgress() {
  const cache = await loadOfficialCache();
  cache.scraped = [];
  cache.scraping = false;
  await saveOfficialCache(cache);
  return cache;
}
