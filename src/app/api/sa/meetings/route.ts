import { NextRequest } from "next/server";
import { ingestRowsToEvents, saConfigured } from "@/lib/adapters/state-affairs";
import { isAdminRequest, requireAdmin } from "@/lib/admin";
import { corsPreflight, jsonWithCors } from "@/lib/cors";
import { SA_CLIENT_QUERIES } from "@/lib/sa-graphql";
import { loadSaCache, mergeSaEvents, saCacheStale } from "@/lib/sa-cache";
import { publicSa, refreshSaMeetings } from "@/lib/sa-refresh";
import { sessionStatus } from "@/lib/sa-session";
import { parseStateList, STATE_SOURCES, stateByCode } from "@/lib/states";
import type { CalendarEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 180;
export const dynamic = "force-dynamic";

function asEvents(body: {
  events?: CalendarEvent[];
  meetings?: Array<Record<string, unknown>>;
  hearings?: Array<Record<string, unknown>>;
  state?: string;
}): CalendarEvent[] {
  if (Array.isArray(body.events) && body.events.length) {
    return body.events
      .filter((e) => e && e.sourceId && e.title && e.start && e.state)
      .map((e) => ({
        sourceId: String(e.sourceId),
        state: String(e.state).toUpperCase(),
        title: String(e.title),
        start: String(e.start),
        location: String(e.location || ""),
        chamber: String(e.chamber || ""),
        url: String(e.url || ""),
        bills: Array.isArray(e.bills) ? e.bills.map(String) : [],
      }));
  }
  const state = String(body.state || "").toUpperCase();
  const rows = body.meetings || body.hearings || [];
  if (state && stateByCode(state) && rows.length) return ingestRowsToEvents(state, rows);
  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const code = String(row.state || "").toUpperCase();
    if (!stateByCode(code)) continue;
    const list = grouped.get(code) || [];
    list.push(row);
    grouped.set(code, list);
  }
  const out: CalendarEvent[] = [];
  for (const [code, list] of grouped) out.push(...ingestRowsToEvents(code, list));
  return out;
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req);
}

export async function GET(req: NextRequest) {
  const cache = await loadSaCache();
  const connected = await saConfigured();
  const status = await sessionStatus();
  const admin = await isAdminRequest(req);
  return jsonWithCors(req, {
    ok: true,
    connected,
    stale: saCacheStale(cache),
    account: admin ? status.name || status.email || "" : "",
    graphql: admin ? SA_CLIENT_QUERIES : undefined,
    states: admin ? STATE_SOURCES.map((s) => s.code) : [],
    ...publicSa(cache),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    states?: string;
    events?: CalendarEvent[];
    meetings?: Array<Record<string, unknown>>;
    hearings?: Array<Record<string, unknown>>;
    state?: string;
    scrapedStates?: string[];
    force?: boolean;
  };

  const action = body.action || "refresh";
  if (action !== "refresh") {
    const blocked = await requireAdmin(req);
    if (blocked) return blocked;
  }

  try {
    if (action === "refresh") {
      const codes = parseStateList(typeof body.states === "string" ? body.states : null);
      const result = await refreshSaMeetings(codes.length ? codes : undefined, { force: Boolean(body.force) });
      const connected = await saConfigured();
      return jsonWithCors(req, { ok: true, connected, ...result });
    }

    if (action === "ingest") {
      const events = asEvents(body);
      const scrapedStates = Array.isArray(body.scrapedStates) ? body.scrapedStates : [];
      if (!events.length && !scrapedStates.length) {
        return jsonWithCors(req, { ok: false, error: "No State Affairs meetings in the payload." }, { status: 400 });
      }
      const cache = await mergeSaEvents(events, scrapedStates);
      return jsonWithCors(req, { ok: true, connected: true, ...publicSa(cache) });
    }

    return jsonWithCors(req, { ok: false, error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const cache = await loadSaCache();
    return jsonWithCors(
      req,
      {
        ok: false,
        connected: await saConfigured(),
        ...publicSa(cache),
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }
}
