import { mkdirSync, writeFileSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const profileDir = path.join(dataDir, "sa-playwright-profile");
const authFile = path.join(dataDir, "sa-auth.json");
const sessionFile = path.join(dataDir, "sa-session.json");
const queryFile = path.join(dataDir, "sa-meetings-query.json");
const capturedFile = path.join(dataDir, "sa-meetings-captured.json");
const statusFile = path.join(dataDir, "sa-playwright-status.json");
const lockFile = path.join(dataDir, "sa-playwright.lock");
const logFile = path.join(dataDir, "sa-playwright.log");

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(logFile, line, { flag: "a" });
  } catch {
    /* ignore */
  }
  console.log(message);
}

function writeStatus(next) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(statusFile, JSON.stringify({ ...next, at: new Date().toISOString() }, null, 2));
}

function upcomingWindow(now = new Date()) {
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const end = new Date(now.getFullYear(), now.getMonth() + 4, 2);
  const to = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  return { from, to };
}

function isSessionDomain(domain) {
  const d = String(domain || "")
    .replace(/^\./, "")
    .toLowerCase();
  return (
    d === "stateaffairs.com" ||
    d.endsWith(".stateaffairs.com") ||
    d === "cloudflareaccess.com" ||
    d.endsWith(".cloudflareaccess.com")
  );
}

function cookieHeader(cookies) {
  const ranked = [...(cookies || [])]
    .filter((c) => c?.name && c?.value && isSessionDomain(c.domain))
    .sort((a, b) => {
      const rank = (domain) => {
        const d = String(domain || "")
          .replace(/^\./, "")
          .toLowerCase();
        if (d.startsWith("api.")) return 4;
        if (d.startsWith("admin.")) return 3;
        if (d.includes("cloudflareaccess")) return 2;
        return 1;
      };
      return rank(a.domain) - rank(b.domain);
    });
  const byName = new Map();
  for (const cookie of ranked) byName.set(cookie.name, cookie.value);
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

function isHiddenRow(row) {
  if (!row || typeof row !== "object") return false;
  const flags = [row.hidden, row.is_hidden, row.isHidden, row.hide, row.unpublished, row.unlisted, row.is_hidden_from_customer];
  if (flags.some((v) => v === true || v === 1 || /^(true|1|yes|hidden)$/i.test(String(v || "")))) return true;
  const status = String(row.status || row.visibility || row.visibility_status || row.publication_status || "")
    .trim()
    .toLowerCase();
  if (status === "hidden" || status === "unpublished" || status === "unlisted") return true;
  const text = `${row.title || ""} ${row.description || ""} ${row.label || ""} ${row.badge || ""}`;
  return /[\[(]\s*hidden\s*[\])]/i.test(text) || /\bhidden\s*[-–—:]/i.test(text) || /[-–—:|]\s*hidden\b/i.test(text);
}

function meetingsPayload(body) {
  if (!body || typeof body !== "object") return null;
  const name = String(body.operationName || "");
  const query = String(body.query || "");
  const blob = `${name}\n${query}`;
  if (/getMeetingsList|GetMeetingsList|includeHidden/i.test(blob)) return body;
  return null;
}

function listFromData(data) {
  if (!data || typeof data !== "object") return null;
  for (const key of ["meetingsSearchV2", "getMeetingsList", "getHearingsList"]) {
    if (data[key]?.data) return { key, payload: data[key] };
  }
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && Array.isArray(value.data)) return { key, payload: value };
  }
  return null;
}

function writeSession(storage) {
  let existing = {};
  try {
    existing = JSON.parse(require("fs").readFileSync(sessionFile, "utf8"));
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
    promptDaily: existing.promptDaily === true,
  };
  writeFileSync(sessionFile, JSON.stringify(session, null, 2));
}

async function launchContext(playwright) {
  const channel = (process.env.SA_BROWSER_CHANNEL || "msedge").trim();
  const useChannel = !["", "0", "none", "chromium"].includes(channel.toLowerCase());
  const opts = {
    headless: false,
    viewport: { width: 1500, height: 940 },
    args: ["--disable-blink-features=AutomationControlled"],
  };
  if (useChannel) opts.channel = channel;
  try {
    return await playwright.chromium.launchPersistentContext(profileDir, opts);
  } catch (err) {
    log(`Edge/Chrome channel failed (${err instanceof Error ? err.message : err}). Using Chromium.`);
    delete opts.channel;
    return playwright.chromium.launchPersistentContext(profileDir, opts);
  }
}

async function waitForLogin(page, waitMs = 15 * 60 * 1000) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const url = page.url();
    const title = await page.title().catch(() => "");
    if (!looksLikeLogin(url, title) && /admin\.stateaffairs\.com/i.test(url)) return true;
    await page.waitForTimeout(2000);
  }
  return false;
}

async function replayPages(page, capturedQuery, from, to) {
  const rows = [];
  const original = capturedQuery.variables || {};
  const itemsPerPage = Math.max(Number(original.itemsPerPage) || 20, 100);
  const operationName = capturedQuery.operationName || "MeetingsSearchV2";
  const zeroBased = /meetingsSearchV2/i.test(capturedQuery.query || "");
  let total = 0;
  for (let i = 0; i < 250; i++) {
    const pageNo = zeroBased ? i : i + 1;
    const variables = { ...original, page: pageNo, itemsPerPage };
    if ("startDate" in original) variables.startDate = from;
    if ("endDate" in original) variables.endDate = to;
    if ("includeHidden" in original) variables.includeHidden = false;
    const json = await page.evaluate(
      async ({ query, variables, operationName }) => {
        const res = await fetch("https://api.stateaffairs.com/graphql", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operationName, query, variables }),
        });
        return res.json();
      },
      { query: capturedQuery.query, variables, operationName },
    );
    if (json?.errors?.length) {
      throw new Error(json.errors.map((e) => e.message).filter(Boolean).join("; ") || "Meetings query failed");
    }
    const listed = listFromData(json?.data);
    const chunk = listed?.payload?.data || [];
    total = listed?.payload?.totalMeetingCount || listed?.payload?.total_count || total;
    rows.push(...chunk);
    log(`Meetings page ${zeroBased ? i + 1 : pageNo}: ${chunk.length} rows (kept ${rows.length}, reported ${total || rows.length})`);
    if (!chunk.length || chunk.length < itemsPerPage) break;
  }
  return rows;
}

async function main() {
  mkdirSync(profileDir, { recursive: true });
  writeStatus({ running: true });
  let playwright;
  try {
    playwright = require("playwright");
  } catch {
    throw new Error("Playwright is not installed. Run npm install playwright in this project.");
  }

  const { from, to } = upcomingWindow();
  const meetingsUrl = `https://admin.stateaffairs.com/meetings?state=all&startDate=${from}&endDate=${to}&includeHidden=true`;
  const captured = { query: null, rows: [], configs: [] };

  log("Opening a browser window. Finish JumpCloud / Cloudflare Access there.");
  const context = await launchContext(playwright);
  try {
    const page = context.pages()[0] || (await context.newPage());
    page.on("request", (req) => {
      if (!/api\.stateaffairs\.com\/graphql/i.test(req.url())) return;
      const post = req.postData();
      if (!post) return;
      try {
        const body = JSON.parse(post);
        const hit = meetingsPayload(body);
        if (hit) captured.query = hit;
      } catch {
        /* ignore */
      }
    });
    page.on("response", async (res) => {
      if (!/api\.stateaffairs\.com\/graphql/i.test(res.url())) return;
      try {
        const json = await res.json();
        const configs = json?.data?.stateConfigs;
        if (Array.isArray(configs) && configs.length) captured.configs = configs;
        const listed = listFromData(json?.data);
        if ((listed?.key === "meetingsSearchV2" || listed?.key === "getMeetingsList") && listed?.payload?.data) {
          captured.rows.push(...listed.payload.data);
        }
      } catch {
        /* ignore */
      }
    });

    await page.goto(meetingsUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    if (!(await waitForLogin(page))) {
      throw new Error("Still on the Cloudflare / JumpCloud login screen. Finish sign-in and run this again.");
    }
    if (!/\/meetings/i.test(page.url())) {
      await page.goto(meetingsUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForTimeout(2500);
    } else {
      await page.waitForTimeout(4000);
    }

    const storage = await context.storageState({ path: authFile });
    writeSession(storage);
    log("Saved the Playwright session for reuse.");

    if (!captured.query) {
      await page.waitForTimeout(4000);
    }
    if (captured.query?.query) {
      writeFileSync(queryFile, JSON.stringify(captured.query, null, 2));
      log(`Captured ${captured.query.operationName || "meetings"} query.`);
      try {
        const paged = await replayPages(page, captured.query, from, to);
        if (paged.length) captured.rows = paged;
      } catch (err) {
        log(`Could not page through GraphQL (${err instanceof Error ? err.message : err}). Using what the page already loaded.`);
      }
    } else {
      log("Signed in, but the Meetings GraphQL query did not appear. Session is still saved.");
    }

    const seen = new Set();
    const unique = [];
    let hiddenSkipped = 0;
    for (const row of captured.rows) {
      const id = String(row?.entity_id || row?.meeting_id || row?.id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (row?.is_cancelled || isHiddenRow(row)) {
        hiddenSkipped += 1;
        continue;
      }
      unique.push(row);
    }
    writeFileSync(
      capturedFile,
      JSON.stringify(
        {
          from,
          to,
          capturedAt: new Date().toISOString(),
          operationName: captured.query?.operationName || "",
          configs: captured.configs,
          rows: unique,
          hiddenSkipped,
        },
        null,
        2,
      ),
    );
    writeStatus({
      running: false,
      ok: true,
      queryCaptured: Boolean(captured.query?.query),
      meetings: unique.length,
      hiddenSkipped,
    });
    log(`Done. Visible meetings kept: ${unique.length}. Hidden skipped: ${hiddenSkipped}.`);
  } finally {
    await context.close().catch(() => undefined);
    try {
      require("fs").unlinkSync(lockFile);
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  log(message);
  writeStatus({ running: false, ok: false, error: message });
  try {
    require("fs").unlinkSync(lockFile);
  } catch {
    /* ignore */
  }
  process.exitCode = 1;
});
