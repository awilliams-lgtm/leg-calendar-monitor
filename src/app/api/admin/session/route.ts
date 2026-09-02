import { NextRequest, NextResponse } from "next/server";
import {
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
  return NextResponse.json({
    ok: true,
    admin: await isAdminRequest(req),
    setupRequired: await adminSetupRequired(),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    password?: string;
  };
  const password = String(body.password || "");

  if (body.action === "setup") {
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
    return NextResponse.json({ ok: false, error: "Wrong admin password." }, { status: 401 });
  }
  const token = await makeAdminToken();
  await markExtensionUnlock();
  const res = NextResponse.json({ ok: true, admin: true, setupRequired: false });
  return applyAdminCookie(res, token);
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true, admin: false });
  return clearAdminCookie(res);
}
