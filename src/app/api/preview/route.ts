import { NextRequest, NextResponse } from "next/server";
import { fetchOfficialEvents } from "@/lib/adapters/official";
import { assertCron } from "@/lib/auth";
import { STATE_SOURCES, parseStateList, stateByCode } from "@/lib/states";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const unauthorized = assertCron(req);
  if (unauthorized) return unauthorized;

  const codes = parseStateList(req.nextUrl.searchParams.get("states") || req.nextUrl.searchParams.get("state"));
  const list = codes.length ? codes : STATE_SOURCES.map((s) => s.code).slice(0, 1);
  const results = [];
  for (const code of list) {
    const src = stateByCode(code);
    if (!src) continue;
    const pulled = await fetchOfficialEvents(src);
    results.push({
      state: code,
      count: pulled.events.length,
      notes: pulled.notes,
      events: pulled.events.slice(0, 25),
    });
  }
  return NextResponse.json({ ok: true, results });
}
