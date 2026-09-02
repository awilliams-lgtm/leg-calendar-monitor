import { NextRequest, NextResponse } from "next/server";
import { summariesFromEvents } from "@/lib/calendar";
import { dashboardStats, monthOverview } from "@/lib/data";
import { monthBounds, parseMonth } from "@/lib/dates";
import { databaseUrl } from "@/lib/db";
import { loadHandledOfficialKeys } from "@/lib/handled";
import { loadOfficialCache, statePullIsStale } from "@/lib/official-cache";
import { loadSaCache, saByStateMap } from "@/lib/sa-cache";
import { STATE_SOURCES } from "@/lib/states";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { key } = parseMonth(req.nextUrl.searchParams.get("month"));
  const { label } = monthBounds(key);
  const saCache = await loadSaCache();
  const saByState = saByStateMap(saCache.events);

  if (databaseUrl()) {
    try {
      const [states, stats] = await Promise.all([monthOverview(key), dashboardStats()]);
      const hasEvents = states.some((s) => s.onSa + s.missing > 0);
      if (hasEvents) {
        return NextResponse.json({
          ok: true,
          month: key,
          label,
          states,
          saUpdatedAt: saCache.updatedAt,
          saConnected: saCache.events.length > 0,
          stats: {
            ...stats,
            saEvents: saCache.events.length || stats.saEvents,
            officialThisMonth: states.reduce((n, s) => n + s.onSa + s.missing, 0),
            saThisMonth: states.reduce((n, s) => n + (s.saMeetings || 0), 0),
          },
        });
      }
    } catch {
      /* fall through to file cache */
    }
  }

  const cache = await loadOfficialCache();
  const due = STATE_SOURCES.filter((s) => statePullIsStale(cache, s.code)).length;
  const handled = await loadHandledOfficialKeys();
  const states = summariesFromEvents(cache.events, key, saByState, handled);
  const officialThisMonth = states.reduce((n, s) => n + s.onSa + s.missing, 0);
  const saThisMonth = states.reduce((n, s) => n + s.saMeetings, 0);
  return NextResponse.json({
    ok: true,
    demo: !cache.events.length,
    scraping: cache.scraping || cache.scraped.length < STATE_SOURCES.length || due > 0,
    stale: due > 0,
    scraped: cache.scraped.length,
    scrapedCodes: cache.scraped,
    saScraping: saCache.scraping || (saCache.scraped.length > 0 && saCache.scraped.length < STATE_SOURCES.length),
    saScraped: saCache.scraped.length,
    saConnected: saCache.events.length > 0 || Boolean(saCache.scraped.length),
    saUpdatedAt: saCache.updatedAt,
    saNeedsBrowserFetch: saCache.needsBrowserFetch,
    saError: saCache.error || "",
    total: STATE_SOURCES.length,
    month: key,
    label,
    states,
    stats: {
      openGaps: states.reduce((n, s) => n + s.missing, 0),
      unread: 0,
      officialThisMonth,
      saThisMonth,
      officialEvents: cache.events.length,
      saEvents: saCache.events.length,
    },
  });
}
