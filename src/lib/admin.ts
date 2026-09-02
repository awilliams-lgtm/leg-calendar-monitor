import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { jsonWithCors } from "@/lib/cors";

export const ADMIN_COOKIE = "sa_admin";
const TTL_SEC = 30 * 24 * 60 * 60;
const FILE = path.join(process.cwd(), "data", "admin.json");
const UNLOCK_FILE = path.join(process.cwd(), "data", "admin-unlock.json");

type AdminFile = {
  salt: string;
  hash: string;
  cookieSecret: string;
};

let memory: AdminFile | null | undefined;

function envPassword(): string {
  return process.env.ADMIN_PASSWORD?.trim() || "";
}

function envUnlock(): string {
  return envPassword() || process.env.ADMIN_SECRET?.trim() || process.env.INGEST_SECRET?.trim() || process.env.CRON_SECRET?.trim() || "";
}

async function readFileConfig(): Promise<AdminFile | null> {
  if (memory !== undefined) return memory;
  try {
    const raw = await readFile(FILE, "utf8");
    memory = JSON.parse(raw) as AdminFile;
    return memory;
  } catch {
    memory = null;
    return null;
  }
}

async function writeFileConfig(next: AdminFile) {
  memory = next;
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(next, null, 2), "utf8");
}

function scryptHash(password: string, saltHex: string): string {
  return scryptSync(password, Buffer.from(saltHex, "hex"), 64).toString("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function adminSetupRequired(): Promise<boolean> {
  if (envPassword()) return false;
  return !(await readFileConfig());
}

export async function adminConfigured(): Promise<boolean> {
  return Boolean(envPassword() || (await readFileConfig()));
}

export async function setupAdminPassword(password: string): Promise<{ ok: boolean; error?: string }> {
  if (process.env.VERCEL) return { ok: false, error: "Set ADMIN_PASSWORD in the server environment." };
  if (password.trim().length < 8) return { ok: false, error: "Use at least 8 characters." };
  if (!(await adminSetupRequired())) return { ok: false, error: "An admin password is already set." };
  const salt = randomBytes(16).toString("hex");
  const cookieSecret = randomBytes(32).toString("hex");
  await writeFileConfig({
    salt,
    hash: scryptHash(password, salt),
    cookieSecret,
  });
  return { ok: true };
}

async function passwordMatches(password: string): Promise<boolean> {
  const env = envPassword();
  if (env && safeEqual(env, password)) return true;
  const file = await readFileConfig();
  if (!file) return false;
  return safeEqual(file.hash, scryptHash(password, file.salt));
}

async function signingSecret(): Promise<string> {
  if (envPassword()) return envPassword();
  const file = await readFileConfig();
  return file?.cookieSecret || envUnlock() || "leg-calendar-admin";
}

function signValue(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export async function makeAdminToken(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + TTL_SEC;
  const payload = `admin.${exp}`;
  const secret = await signingSecret();
  return `${payload}.${signValue(payload, secret)}`;
}

export async function tokenIsValid(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [role, expRaw, sig] = parts;
  const payload = `${role}.${expRaw}`;
  const secret = await signingSecret();
  if (!safeEqual(sig, signValue(payload, secret))) return false;
  if (role !== "admin") return false;
  const exp = Number(expRaw);
  return Number.isFinite(exp) && exp * 1000 > Date.now();
}

function bearer(req: NextRequest): string {
  const auth = req.headers.get("authorization") || "";
  return auth.replace(/^Bearer\s+/i, "").trim();
}

async function extensionUnlocked(): Promise<boolean> {
  try {
    const raw = await readFile(UNLOCK_FILE, "utf8");
    const until = Date.parse(JSON.parse(raw).until as string);
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

export async function markExtensionUnlock() {
  await mkdir(path.dirname(UNLOCK_FILE), { recursive: true });
  await writeFile(
    UNLOCK_FILE,
    JSON.stringify({ until: new Date(Date.now() + TTL_SEC * 1000).toISOString() }),
    "utf8",
  );
}

export async function isAdminRequest(req: NextRequest): Promise<boolean> {
  if (await tokenIsValid(req.cookies.get(ADMIN_COOKIE)?.value)) return true;
  if (await tokenIsValid(bearer(req))) return true;

  const key = bearer(req);
  if (key) {
    const env = envPassword();
    if (env && safeEqual(env, key)) return true;
    const ingest = process.env.INGEST_SECRET?.trim() || process.env.CRON_SECRET?.trim() || "";
    if (ingest && safeEqual(ingest, key)) return true;
  }

  const origin = req.headers.get("origin") || "";
  const connector = req.headers.get("x-sa-connector") === "1";
  if (
    (origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://") || connector) &&
    (await extensionUnlocked())
  ) {
    return true;
  }
  return false;
}

export function applyAdminCookie(res: NextResponse, token: string) {
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SEC,
    secure: Boolean(process.env.VERCEL),
  });
  return res;
}

export function clearAdminCookie(res: NextResponse) {
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}

export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  if (await isAdminRequest(req)) return null;
  const setup = await adminSetupRequired();
  return jsonWithCors(
    req,
    {
      ok: false,
      error: setup
        ? "Create an admin password in Settings first."
        : "Admin only. Log in on Settings to change this.",
      setupRequired: setup,
    },
    { status: 401 },
  );
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  return passwordMatches(password);
}
