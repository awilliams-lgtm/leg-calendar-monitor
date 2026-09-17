import { NextResponse } from "next/server";
import { listNotifications, markNotificationsRead, unreadCount } from "@/lib/data";
import { databaseUrl } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!databaseUrl()) {
    return NextResponse.json({ ok: true, notifications: [], unread: 0, fromCache: true });
  }
  const [notifications, unread] = await Promise.all([listNotifications(false), unreadCount()]);
  return NextResponse.json({ ok: true, notifications, unread }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  if (!databaseUrl()) {
    return NextResponse.json({ ok: true, unread: 0, fromCache: true });
  }
  await markNotificationsRead();
  return NextResponse.json({ ok: true, unread: 0 });
}
