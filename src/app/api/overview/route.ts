import { NextRequest, NextResponse } from "next/server";
import { coverageByState, dashboardStats, listGaps } from "@/lib/data";
import { databaseUrl } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!databaseUrl()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL is not set", demo: true }, { status: 503 });
  }
  const state = req.nextUrl.searchParams.get("state") || undefined;
  const stats = await dashboardStats();
  const coverage = await coverageByState();
  const gaps = await listGaps({ state, status: "open", limit: 80 });
  return NextResponse.json({ ok: true, stats, coverage, gaps });
}
