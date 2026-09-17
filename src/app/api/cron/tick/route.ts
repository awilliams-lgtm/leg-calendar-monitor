import { NextRequest, NextResponse } from "next/server";
import { fetchSaProfile, saConfigured } from "@/lib/adapters/state-affairs";
import { assertCron } from "@/lib/auth";
import { getMeta, setMeta } from "@/lib/data";
import { isEasternScrapeHour } from "@/lib/dates";
import { loadOfficialCache } from "@/lib/official-cache";
import { refreshSaMeetings } from "@/lib/sa-refresh";
import { parseStateList, STATE_SOURCES } from "@/lib/states";
import { nextBatch, syncState } from "@/lib/sync";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const unauthorized = assertCron(req);
  if (unauthorized) return unauthorized;

  const all = req.nextUrl.searchParams.get("states") === "all";
  const requested = all ? STATE_SOURCES.map((s) => s.code) : parseStateList(req.nextUrl.searchParams.get("states"));
  const forced = all || requested.length > 0 || req.nextUrl.searchParams.get("force") === "1";
  const existing = await loadOfficialCache();
  const incomplete = existing.scraped.length < STATE_SOURCES.length || existing.events.length === 0;
  if (!forced && !isEasternScrapeHour() && !incomplete) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "outside-7am-5pm-et",
    });
  }
  const batchSize = Math.max(1, Math.min(Number(process.env.SYNC_BATCH_SIZE || 8), 15));
  const rounds = requested.length ? 1 : incomplete ? 3 : 1;

  let codes: string[] = requested;
  let nextCursor: number | null = null;
  const results = [];
  for (let round = 0; round < rounds; round += 1) {
    if (!requested.length) {
      let cursor = 0;
      try {
        cursor = Number((await getMeta("official_cursor")) || 0) || 0;
      } catch {
        cursor = 0;
      }
      const batch = nextBatch(cursor, batchSize);
      codes = batch.codes;
      nextCursor = batch.nextCursor;
    }
    for (const code of codes) {
      results.push(await syncState(code));
    }
    if (nextCursor != null) {
      try {
        await setMeta("official_cursor", String(nextCursor));
      } catch {
        /* scrape still succeeded; cursor will retry this batch */
      }
    }
    if (requested.length) break;
  }

  let sa: Awaited<ReturnType<typeof refreshSaMeetings>> | { error: string } | null = null;
  try {
    if (await saConfigured()) await fetchSaProfile();
    sa = await refreshSaMeetings(undefined, { force: true });
  } catch (err) {
    sa = { error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json({
    ok: true,
    batch: codes,
    nextCursor,
    totalStates: STATE_SOURCES.length,
    results,
    sa,
  });
}
