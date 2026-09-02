import { NextRequest, NextResponse } from "next/server";
import { assertIngest } from "@/lib/auth";
import { ingestRowsToEvents } from "@/lib/adapters/state-affairs";
import { compareState, recordSyncRun, upsertEvents } from "@/lib/data";
import { stateByCode } from "@/lib/states";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const unauthorized = assertIngest(req);
  if (unauthorized) return unauthorized;

  const body = (await req.json().catch(() => ({}))) as {
    state?: string;
    hearings?: Array<Record<string, unknown>>;
  };
  const state = String(body.state || "").toUpperCase();
  if (!stateByCode(state)) {
    return NextResponse.json({ ok: false, error: "Unknown state" }, { status: 400 });
  }
  const hearings = Array.isArray(body.hearings) ? body.hearings : [];
  const events = ingestRowsToEvents(state, hearings);
  const saved = await upsertEvents("sa", state, events);
  await recordSyncRun(state, "sa-ingest", saved.upserted);
  const compared = await compareState(state);
  return NextResponse.json({
    ok: true,
    state,
    upserted: saved.upserted,
    newGaps: compared.newGaps,
    openGaps: compared.openGaps,
  });
}
