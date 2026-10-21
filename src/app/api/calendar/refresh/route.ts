import { NextRequest, NextResponse } from "next/server";
import { compareState } from "@/lib/data";
import { loadOfficialCache } from "@/lib/official-cache";
import { resetScrapeProgress, scrapeBatch } from "@/lib/scrape";
import { parseStateList, STATE_SOURCES } from "@/lib/states";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("compare") === "1") {
    const codes = parseStateList(req.nextUrl.searchParams.get("states"));
    const wanted = codes.length ? codes : STATE_SOURCES.map((s) => s.code);
    const results = [];
    for (const code of wanted) {
      results.push({ state: code, ...(await compareState(code)) });
    }
    return NextResponse.json({
      ok: true,
      compared: results.length,
      openGaps: results.reduce((n, r) => n + (r.openGaps || 0), 0),
      results,
    });
  }
  const reset = req.nextUrl.searchParams.get("reset") === "1";
  if (reset) await resetScrapeProgress();
  const codes = parseStateList(req.nextUrl.searchParams.get("states"));
  const cache = await scrapeBatch(codes.length ? codes : undefined);
  return NextResponse.json({
    ok: true,
    scraping: cache.scraping,
    scraped: cache.scraped.length,
    total: codes.length || STATE_SOURCES.length,
    events: cache.events.length,
    updatedAt: cache.updatedAt,
  });
}

export async function POST() {
  const cache = await loadOfficialCache();
  return NextResponse.json({
    ok: true,
    scraping: cache.scraping,
    scraped: cache.scraped.length,
    total: STATE_SOURCES.length,
    events: cache.events.length,
    updatedAt: cache.updatedAt,
  });
}
