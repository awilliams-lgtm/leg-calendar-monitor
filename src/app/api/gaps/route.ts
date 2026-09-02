import { NextRequest, NextResponse } from "next/server";
import { listCachedGaps, setCachedGapStatus } from "@/lib/cached-gaps";
import { listGaps, setGapStatus } from "@/lib/data";
import { databaseUrl } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("state") || undefined;
  const month = req.nextUrl.searchParams.get("month") || undefined;
  const status = req.nextUrl.searchParams.get("status") || "open";

  if (databaseUrl()) {
    const gaps = await listGaps({ state, status, limit: 300 });
    return NextResponse.json({ ok: true, gaps });
  }

  const gaps = await listCachedGaps({ state, month });
  return NextResponse.json({ ok: true, gaps, fromCache: true });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    id?: number;
    status?: "open" | "dismissed";
    state?: string;
    officialSourceId?: string;
  };
  if (body.status !== "open" && body.status !== "dismissed") {
    return NextResponse.json({ ok: false, error: "Provide status" }, { status: 400 });
  }

  if (databaseUrl() && body.id) {
    await setGapStatus(body.id, body.status);
  }
  await setCachedGapStatus(body.status, {
    id: body.id,
    state: body.state,
    officialSourceId: body.officialSourceId,
  });
  return NextResponse.json({ ok: true, fromCache: true });
}
