import { NextRequest, NextResponse } from "next/server";
import {
  adminConfigured,
  adminSetupRequired,
  applyAdminCookie,
  clearAdminCookie,
  isAdminRequest,
  makeAdminToken,
  markExtensionUnlock,
  setupAdminPassword,
  verifyAdminPassword,
} from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      ok: true,
      admin: await isAdminRequest(req),
      setupRequired: await adminSetupRequired(),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, admin: false, setupRequired: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      password?: string;
    };
    const password = String(body.password || "").trim();

    if (body.action === "setup" && (await adminSetupRequired())) {
      const created = await setupAdminPassword(password);
      if (!created.ok) {
        return NextResponse.json({ ok: false, error: created.error }, { status: 400 });
      }
      const token = await makeAdminToken();
      await markExtensionUnlock();
      const res = NextResponse.json({ ok: true, admin: true, setupRequired: false });
      return applyAdminCookie(res, token);
    }

    if (!(await verifyAdminPassword(password))) {
      const configured = await adminConfigured();
      return NextResponse.json(
        {
          ok: false,
          error: configured
            ? "Wrong admin password."
            : "Admin password is not loaded on the server. Check ADMIN_PASSWORD in Vercel env vars.",
        },
        { status: 401 },
      );
    }
    const token = await makeAdminToken();
    await markExtensionUnlock();
    const res = NextResponse.json({ ok: true, admin: true, setupRequired: false });
    return applyAdminCookie(res, token);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true, admin: false });
  return clearAdminCookie(res);
}
