import { NextRequest, NextResponse } from "next/server";

function allowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (origin.startsWith("chrome-extension://")) return true;
  if (origin.startsWith("moz-extension://")) return true;
  if (origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000") return true;
  return false;
}

export function corsHeaders(req: NextRequest): HeadersInit {
  const origin = req.headers.get("origin") || "";
  const allow = allowedOrigin(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, x-sa-connector",
    Vary: "Origin",
  };
}

export function jsonWithCors(req: NextRequest, body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: corsHeaders(req),
  });
}

export function corsPreflight(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}
