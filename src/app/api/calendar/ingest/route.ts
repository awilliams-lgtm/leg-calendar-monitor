import { NextRequest } from "next/server";
import { parseOfficialPage } from "@/lib/adapters/official";
import { stateFromOfficialUrl } from "@/lib/adapters/official-extra";
import { requireAdmin } from "@/lib/admin";
import { corsPreflight, jsonWithCors } from "@/lib/cors";
import { mergeStateEvents } from "@/lib/official-cache";
import { stateByCode } from "@/lib/states";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req);
}

export async function POST(req: NextRequest) {
  const blocked = await requireAdmin(req);
  if (blocked) return blocked;

  const body = (await req.json().catch(() => ({}))) as {
    url?: string;
    html?: string;
    state?: string;
  };
  const pageUrl = String(body.url || "").trim();
  const html = String(body.html || "");
  if (!pageUrl || html.length < 40) {
    return jsonWithCors(req, { ok: false, error: "Open the official calendar page, then capture it." }, { status: 400 });
  }

  const code = (String(body.state || "").toUpperCase() || stateFromOfficialUrl(pageUrl) || "").trim();
  if (!stateByCode(code)) {
    return jsonWithCors(
      req,
      { ok: false, error: "Could not tell which state this page is for. Open a legislature calendar, then capture." },
      { status: 400 },
    );
  }

  const events = parseOfficialPage(code, html, pageUrl);
  if (!events.length) {
    return jsonWithCors(
      req,
      {
        ok: false,
        state: code,
        error:
          "No meetings found on this page. Wait until the calendar is visible in the tab, then capture again.",
      },
      { status: 400 },
    );
  }
  const merged = await mergeStateEvents(code, events, [`${code} browser capture → ${events.length} from ${pageUrl}`]);
  return jsonWithCors(req, {
    ok: true,
    state: code,
    added: merged.added,
    events: merged.total,
    url: pageUrl,
  });
}
