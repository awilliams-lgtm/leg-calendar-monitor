import { NextRequest, NextResponse } from "next/server";
import { assertCron } from "@/lib/auth";
import { getMeta, setMeta } from "@/lib/data";
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
  const batchSize = Math.max(1, Math.min(Number(process.env.SYNC_BATCH_SIZE || 8), 15));

  let codes = requested;
  let nextCursor: number | null = null;
  if (!codes.length) {
    const raw = await getMeta("official_cursor");
    const cursor = Number(raw || 0) || 0;
    const batch = nextBatch(cursor, batchSize);
    codes = batch.codes;
    nextCursor = batch.nextCursor;
  }

  const results = [];
  for (const code of codes) {
    results.push(await syncState(code));
  }

  if (nextCursor != null) {
    await setMeta("official_cursor", String(nextCursor));
  }

  let sa: Awaited<ReturnType<typeof refreshSaMeetings>> | { error: string } | null = null;
  try {
    sa = await refreshSaMeetings();
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
