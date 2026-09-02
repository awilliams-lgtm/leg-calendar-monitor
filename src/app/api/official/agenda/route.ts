import { NextRequest, NextResponse } from "next/server";
import { allowedOfficialAgendaUrl, fetchOfficialAgenda } from "@/lib/official-agenda";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") || "";
  if (!url || !allowedOfficialAgendaUrl(url)) {
    return NextResponse.json({ ok: false, error: "Provide an official House or Senate agenda URL" }, { status: 400 });
  }
  try {
    const agenda = await fetchOfficialAgenda(url);
    return NextResponse.json({ ok: true, ...agenda });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to load agenda" },
      { status: 502 },
    );
  }
}
