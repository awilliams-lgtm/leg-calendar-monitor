import { NextRequest, NextResponse } from "next/server";
import { buildAnalytics } from "@/lib/analytics";
import { monthKey } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("month") || monthKey()).trim();
  const month = raw === "all" || /^\d{4}-\d{2}$/.test(raw) ? raw : monthKey();
  try {
    const data = await buildAnalytics(month);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
