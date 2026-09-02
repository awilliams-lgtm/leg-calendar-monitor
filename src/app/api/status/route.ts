import { NextResponse } from "next/server";
import { saConfigured } from "@/lib/adapters/state-affairs";
import { databaseUrl } from "@/lib/db";
import { envVar } from "@/lib/env";
import { STATE_SOURCES } from "@/lib/states";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    states: STATE_SOURCES.length,
    database: Boolean(databaseUrl()),
    hosted: Boolean(envVar("VERCEL")),
    openstates: Boolean(envVar("OPENSTATES_API_KEY")),
    stateAffairs: await saConfigured(),
    slack: Boolean(envVar("SLACK_WEBHOOK_URL")),
    email: Boolean(envVar("RESEND_API_KEY") && envVar("ALERT_TO_EMAIL")),
    cron: Boolean(envVar("CRON_SECRET")),
  });
}
