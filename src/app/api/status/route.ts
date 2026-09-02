import { NextResponse } from "next/server";
import { saConfigured } from "@/lib/adapters/state-affairs";
import { databaseUrl } from "@/lib/db";
import { STATE_SOURCES } from "@/lib/states";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    states: STATE_SOURCES.length,
    database: Boolean(databaseUrl()),
    openstates: Boolean(process.env.OPENSTATES_API_KEY?.trim()),
    stateAffairs: await saConfigured(),
    slack: Boolean(process.env.SLACK_WEBHOOK_URL?.trim()),
    email: Boolean(process.env.RESEND_API_KEY?.trim() && process.env.ALERT_TO_EMAIL?.trim()),
    cron: Boolean(process.env.CRON_SECRET?.trim()),
  });
}
