import { NextRequest, NextResponse } from "next/server";
import { loadOfficialCache } from "@/lib/official-cache";
import { resetScrapeProgress, scrapeBatch } from "@/lib/scrape";
import { parseStateList, STATE_SOURCES } from "@/lib/states";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
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
