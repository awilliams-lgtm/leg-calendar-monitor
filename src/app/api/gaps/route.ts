import { NextRequest, NextResponse } from "next/server";
import { listCachedGaps, setCachedGapStatus } from "@/lib/cached-gaps";
import { listGaps, setGapStatus } from "@/lib/data";
import { databaseUrl } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("state") || undefined;
  const month = req.nextUrl.searchParams.get("month") || undefined;
  const status = req.nextUrl.searchParams.get("status") || "open";

  if (databaseUrl()) {
    try {
      const gaps = await listGaps({ state, status, month, limit: 300 });
      return NextResponse.json({ ok: true, gaps }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : "Failed to load missing events" },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  const gaps = await listCachedGaps({ state, month, status });
  return NextResponse.json({ ok: true, gaps, fromCache: true });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    id?: number;
    status?: "open" | "dismissed" | "irrelevant";
    state?: string;
    officialSourceId?: string;
    title?: string;
    start?: string;
    chamber?: string;
  };
  if (body.status !== "open" && body.status !== "dismissed" && body.status !== "irrelevant") {
    return NextResponse.json({ ok: false, error: "Provide status" }, { status: 400 });
  }

  if (databaseUrl() && (body.id || (body.state && body.officialSourceId))) {
    await setGapStatus(body.id || 0, body.status, {
      state: body.state,
      officialSourceId: body.officialSourceId,
    });
  }
  await setCachedGapStatus(body.status, {
    id: body.id,
    state: body.state,
    officialSourceId: body.officialSourceId,
    title: body.title,
    start: body.start,
    chamber: body.chamber,
  });
  return NextResponse.json({ ok: true, fromCache: true });
}
