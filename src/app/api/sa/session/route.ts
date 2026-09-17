import { NextRequest } from "next/server";
import { fetchSaProfile } from "@/lib/adapters/state-affairs";
import { importCapturedWindow } from "@/lib/sa-refresh";
import { requireAdmin } from "@/lib/admin";
import { corsPreflight, jsonWithCors } from "@/lib/cors";
import { playwrightStatus, startPlaywrightLogin } from "@/lib/sa-playwright";
import {
  clearSession,
  cookiesToHeader,
  importPlaywrightSession,
  loadSession,
  markSessionOk,
  parseSessionInput,
  saveSession,
  sessionStatus,
  type SaSession,
} from "@/lib/sa-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CookieLike = { name?: string; value?: string; domain?: string };

async function persistAndCheck(req: NextRequest, session: SaSession, status = 200) {
  try {
    await saveSession(session);
  } catch (err) {
    return jsonWithCors(
      req,
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
  try {
    const profile = await fetchSaProfile();
    return jsonWithCors(req, { ok: true, profile, ...(await sessionStatus()) }, { status });
  } catch (err) {
    return jsonWithCors(
      req,
      {
        ok: true,
        saved: true,
        profileError: err instanceof Error ? err.message : String(err),
        ...(await sessionStatus()),
      },
      { status },
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req);
}

export async function GET(req: NextRequest) {
  const check = req.nextUrl.searchParams.get("check") === "1";
  const status = await sessionStatus({ reload: check });
  const playwright = await playwrightStatus();
  if (!check || !status.connected) {
    if (check && playwright.ok && !playwright.running && (playwright.meetings || 0) > 0) {
      await importCapturedWindow().catch(() => undefined);
    }
    return jsonWithCors(req, { ok: true, hosted: Boolean(process.env.VERCEL), ...status, playwright });
  }
  try {
    const profile = await fetchSaProfile();
    if (playwright.ok && !playwright.running && (playwright.meetings || 0) > 0) {
      await importCapturedWindow().catch(() => undefined);
    }
    const next = await sessionStatus({ reload: true });
    return jsonWithCors(req, { ok: true, hosted: Boolean(process.env.VERCEL), ...next, profile, playwright });
  } catch (err) {
    if (playwright.ok && !playwright.running && (playwright.meetings || 0) > 0) {
      await importCapturedWindow().catch(() => undefined);
    }
    const next = await sessionStatus({ reload: true });
    return jsonWithCors(req, {
      ok: false,
      hosted: Boolean(process.env.VERCEL),
      ...next,
      playwright,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function POST(req: NextRequest) {
  const blocked = await requireAdmin(req);
  if (blocked) return blocked;

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    cookie?: string;
    bearer?: string;
    cookies?: CookieLike[];
    source?: SaSession["source"];
    promptDaily?: boolean;
  };

  try {
    if (body.action === "snooze") {
      const session = await loadSession();
      if (!session.cookie && !session.bearer) {
        return jsonWithCors(req, { ok: false, error: "No saved session to keep using." }, { status: 400 });
      }
      await fetchSaProfile();
      return jsonWithCors(req, { ok: true, ...(await sessionStatus()) });
    }

    if (body.action === "import") {
      const session = await importPlaywrightSession();
      return await persistAndCheck(req, session);
    }

    if (body.action === "playwright") {
      const playwright = await startPlaywrightLogin();
      return jsonWithCors(req, { ok: true, started: true, playwright, ...(await sessionStatus({ reload: true })) });
    }

    const fromCookies = Array.isArray(body.cookies) ? cookiesToHeader(body.cookies) : "";
    const parsed = parseSessionInput(body.cookie || "");
    const cookie = fromCookies || parsed.cookie;
    const bearer = body.bearer?.trim() || parsed.bearer;
    if (!cookie && !bearer) {
      return jsonWithCors(
        req,
        { ok: false, error: "Paste a State Affairs cookie or sign in through the browser connector." },
        { status: 400 },
      );
    }

    const current = await loadSession();
    const browserSync = body.action === "browser" || body.source === "browser" || Boolean(fromCookies);
    const session: SaSession = {
      ...current,
      cookie,
      bearer: bearer || parsed.bearer,
      source: browserSync ? "browser" : body.source === "playwright" ? "playwright" : "paste",
      savedAt: new Date().toISOString(),
      lastOkAt: "",
      promptDaily: body.promptDaily === true,
    };
    return await persistAndCheck(req, session);
  } catch (err) {
    return jsonWithCors(
      req,
      { ok: false, error: err instanceof Error ? err.message : String(err), ...(await sessionStatus()) },
      { status: 400 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  const blocked = await requireAdmin(req);
  if (blocked) return blocked;
  const body = (await req.json().catch(() => ({}))) as { promptDaily?: boolean };
  const session = await loadSession();
  session.promptDaily = body.promptDaily !== false;
  if (session.cookie || session.bearer) await saveSession(session);
  else await markSessionOk();
  return jsonWithCors(req, { ok: true, ...(await sessionStatus()) });
}

export async function DELETE(req: NextRequest) {
  const blocked = await requireAdmin(req);
  if (blocked) return blocked;
  await clearSession();
  return jsonWithCors(req, { ok: true, ...(await sessionStatus()) });
}
