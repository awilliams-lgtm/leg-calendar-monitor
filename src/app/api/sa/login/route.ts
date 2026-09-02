import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SA_LOGIN = "https://admin.stateaffairs.com/meetings";

export function GET() {
  return NextResponse.redirect(SA_LOGIN, 302);
}
