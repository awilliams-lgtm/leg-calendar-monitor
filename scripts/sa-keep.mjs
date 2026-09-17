import { existsSync, readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const profileDir = path.join(dataDir, "sa-playwright-profile");
const authFile = path.join(dataDir, "sa-auth.json");
const sessionFile = path.join(dataDir, "sa-session.json");
const KEEP_URL = process.env.SA_KEEP_URL || "https://legcalendarmonitor.vercel.app";

function loadEnvLocal() {
  try {
    const text = readFileSync(path.join(root, ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq);
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    /* optional */
  }
}

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
}

function cookieHeader(cookies) {
  const byName = new Map();
  for (const cookie of cookies || []) {
    if (!cookie?.name || !cookie?.value) continue;
    const d = String(cookie.domain || "")
      .replace(/^\./, "")
      .toLowerCase();
    if (
      !(
        d === "stateaffairs.com" ||
        d.endsWith(".stateaffairs.com") ||
        d === "cloudflareaccess.com" ||
        d.endsWith(".cloudflareaccess.com")
      )
    ) {
      continue;
    }
    byName.set(cookie.name, cookie.value);
  }
  return [...byName.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function bearerFromCookie(cookie) {
  const map = new Map();
  for (const part of String(cookie || "").split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq > 0) map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return map.get("admin_token") || map.get("token") || "";
}

function looksLikeLogin(url, title = "") {
  const u = String(url || "").toLowerCase();
  const t = String(title || "").toLowerCase();
  if (/cloudflareaccess|jumpcloud|sso\.|accounts\.google/.test(u)) return true;
  if (/\/login|\/cdn-cgi\/access/.test(u)) return true;
  return /sign in|log in/.test(t);
}

function writeSessionFromStorage(storage) {
  let existing = {};
  try {
    existing = JSON.parse(readFileSync(sessionFile, "utf8"));
  } catch {
    existing = {};
  }
  const cookie = cookieHeader(storage.cookies || []);
  const session = {
    cookie,
    bearer: bearerFromCookie(cookie) || existing.bearer || "",
    email: existing.email || "",
    name: existing.name || "",
    source: "playwright",
    savedAt: new Date().toISOString(),
    lastOkAt: existing.lastOkAt || "",
    promptDaily: false,
  };
  if (!session.cookie) throw new Error("Browser login had no State Affairs cookies.");
  writeFileSync(sessionFile, JSON.stringify(session, null, 2));
  return session;
}

async function reuseBrowser() {
  if (!existsSync(profileDir) && !existsSync(authFile)) return false;
  let playwright;
  try {
    playwright = require("playwright");
  } catch {
    log("Playwright is not installed; skipping browser reuse.");
    return false;
  }
  const channel = (process.env.SA_BROWSER_CHANNEL || "msedge").trim();
  const opts = {
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: ["--disable-blink-features=AutomationControlled"],
  };
  if (channel && !["0", "none", "chromium"].includes(channel.toLowerCase())) opts.channel = channel;
  let context;
  try {
    context = existsSync(profileDir)
      ? await playwright.chromium.launchPersistentContext(profileDir, opts)
      : await playwright.chromium.launch(opts).then((browser) =>
          browser.newContext({ storageState: authFile }),
        );
  } catch (err) {
    log(`Headless browser failed (${err instanceof Error ? err.message : err}).`);
    return false;
  }
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto("https://admin.stateaffairs.com/meetings", {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(2500);
    if (looksLikeLogin(page.url(), await page.title().catch(() => ""))) {
      log("Saved browser login needs JumpCloud / Cloudflare Access again. Run npm run sa:login.");
      return false;
    }
    const storage = await context.storageState({ path: authFile });
    writeSessionFromStorage(storage);
    log("Reused the saved browser login.");
    return true;
  } finally {
    await context.close().catch(() => undefined);
  }
}

function keepSecret() {
  const ingest = process.env.INGEST_SECRET || "";
  const cron = process.env.CRON_SECRET || "";
  const admin = process.env.ADMIN_PASSWORD || "";
  if (ingest.length >= 16) return ingest;
  if (cron.length >= 16) return cron;
  if (admin.length >= 8 && !/^postgres(ql)?:/i.test(admin)) return admin;
  return ingest || cron || admin;
}

async function pushHosted() {
  const secret = keepSecret();
  if (!secret) {
    log("Add ADMIN_PASSWORD to .env.local (same value as Vercel Settings) so this PC can push the session.");
    return false;
  }
  log(`Using a ${secret.length}-character admin secret for ${KEEP_URL}.`);
  const base = KEEP_URL.replace(/\/$/, "");
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${secret}`,
  };
  const adminPassword = process.env.ADMIN_PASSWORD || "";
  if (adminPassword && secret === adminPassword && !/^postgres(ql)?:/i.test(adminPassword)) {
    const login = await fetch(`${base}/api/admin/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: secret }),
    });
    const loginData = await login.json().catch(() => ({}));
    const cookie = String(login.headers.get("set-cookie") || "")
      .split(/,(?=\s*sa_admin=)/i)[0]
      .split(";")[0];
    if (!login.ok) {
      log(loginData.error || `Hosted admin login failed (${login.status}).`);
    } else if (cookie) {
      headers.cookie = cookie;
    }
  }
  const raw = readFileSync(sessionFile, "utf8");
  const session = JSON.parse(raw);
  if (!session.cookie && !session.bearer) throw new Error("Local SA session is empty.");
  const res = await fetch(`${base}/api/sa/session`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      cookie: session.cookie || "",
      bearer: session.bearer || bearerFromCookie(session.cookie || ""),
      source: "playwright",
      promptDaily: false,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.error || data.message || data.cause || "";
    log(detail ? `${detail} (${res.status})` : `Hosted session push failed (${res.status}).`);
    return false;
  }
  const who = data.profile?.email || data.email || "ok";
  log(`Pushed session to the hosted site (${who}).`);
  return true;
}

async function pushDatabase() {
  const db = process.env.DATABASE_URL || "";
  if (db.length < 24 || !/^postgres(ql)?:\/\//i.test(db) || !/supabase/i.test(db)) {
    log("No writable Supabase DATABASE_URL in .env.local; skipping direct DB push.");
    return false;
  }
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "push-sa-session.mjs")], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  return result.status === 0;
}

async function main() {
  loadEnvLocal();
  const reused = await reuseBrowser();
  if (!existsSync(sessionFile)) {
    log("No local session yet. The hosted site will keep using the Neon session until Access expires.");
    process.exitCode = reused ? 0 : 0;
    return;
  }
  const stored = await pushDatabase().catch((err) => {
    log(err instanceof Error ? err.message : String(err));
    return false;
  });
  const hosted = await pushHosted().catch((err) => {
    log(err instanceof Error ? err.message : String(err));
    return false;
  });
  if (!stored && !hosted) {
    log("Could not store the session remotely. Official calendars still refresh on cron.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
