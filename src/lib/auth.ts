import { NextRequest, NextResponse } from "next/server";
import { envVar } from "@/lib/env";

export function assertCron(req: NextRequest): NextResponse | null {
  const secret = envVar("CRON_SECRET");
  if (!secret) return null;
  const auth = req.headers.get("authorization") || "";
  const query = req.nextUrl.searchParams.get("secret") || "";
  if (auth === `Bearer ${secret}` || query === secret) return null;
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

export function assertIngest(req: NextRequest): NextResponse | null {
  const secret = envVar("INGEST_SECRET") || envVar("CRON_SECRET");
  if (!secret) {
    return NextResponse.json({ ok: false, error: "INGEST_SECRET is not set" }, { status: 401 });
  }
  const auth = req.headers.get("authorization") || "";
  if (auth === `Bearer ${secret}`) return null;
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}
