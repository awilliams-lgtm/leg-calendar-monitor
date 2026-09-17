import { NextRequest, NextResponse } from "next/server";
import { emptyMonthSummaries, summariesFromEvents } from "@/lib/calendar";
import { dashboardStats, monthOverview } from "@/lib/data";
import { monthBounds, parseMonth } from "@/lib/dates";
import { databaseUrl, hostedDatabase } from "@/lib/db";
import { expandReviewKeysFor, loadReviewOfficialKeys } from "@/lib/handled";
import { loadOfficialCache, loadOfficialPullMeta, statePullIsStale } from "@/lib/official-cache";
import { loadSaCache, saByStateMap } from "@/lib/sa-cache";
import { STATE_SOURCES } from "@/lib/states";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  const { key } = parseMonth(req.nextUrl.searchParams.get("month"));
  const { label } = monthBounds(key);

  if (databaseUrl()) {
    try {
      const states = await monthOverview(key);
      const stats = await dashboardStats();
      const officialMeta = await loadOfficialPullMeta();
      const officialThisMonth = states.reduce((n, s) => n + s.onSa + s.missing, 0);
      const saThisMonth = states.reduce((n, s) => n + (s.saMeetings || 0), 0);
      return NextResponse.json({
        ok: true,
        demo: officialThisMonth === 0 && stats.officialEvents === 0,
        scraping: officialMeta.scraping,
        scraped: officialMeta.scraped.length,
        scrapedCodes: officialMeta.scraped,
        saConnected: stats.saEvents > 0,
        saUpdatedAt: officialMeta.updatedAt,
        saNeedsBrowserFetch: false,
        saError: "",
        total: STATE_SOURCES.length,
        month: key,
        label,
        states,
        stats: {
          ...stats,
          officialThisMonth,
          saThisMonth,
        },
      });
    } catch {
      if (hostedDatabase()) {
        return NextResponse.json({
          ok: false,
          error: "Could not load calendars",
          month: key,
          label,
          states: emptyMonthSummaries(),
          total: STATE_SOURCES.length,
        });
      }
    }
  }

  const saCache = await loadSaCache();
  const saByState = saByStateMap(saCache.events);

  const cache = await loadOfficialCache();
  const due = STATE_SOURCES.filter((s) => statePullIsStale(cache, s.code)).length;
  const keys = expandReviewKeysFor(
    await loadReviewOfficialKeys(),
    cache.events.filter((e) => e.start.slice(0, 7) === key),
  );
  const states = summariesFromEvents(cache.events, key, saByState, keys.handled, keys.irrelevant);
  const officialThisMonth = states.reduce((n, s) => n + s.onSa + s.missing, 0);
  const saThisMonth = states.reduce((n, s) => n + s.saMeetings, 0);
  return NextResponse.json({
    ok: true,
    demo: !cache.events.length,
    scraping: cache.scraping,
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
