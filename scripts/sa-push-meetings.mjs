import { readFileSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
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
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    /* optional */
  }
}

function secret() {
  const ingest = process.env.INGEST_SECRET || "";
  const cron = process.env.CRON_SECRET || "";
  const admin = process.env.ADMIN_PASSWORD || "";
  if (ingest.length >= 16) return ingest;
  if (cron.length >= 16) return cron;
  if (admin.length >= 8 && !/^postgres(ql)?:/i.test(admin)) return admin;
  return ingest || cron || admin;
}

async function upsertSupabase(events) {
  const db = process.env.DATABASE_URL || "";
  if (db.length < 24 || !/^postgres(ql)?:\/\//i.test(db) || !/supabase/i.test(db)) {
    console.log(JSON.stringify({ db: "skipped", reason: "no-writable-supabase" }));
    return false;
  }
  const postgres = require("postgres");
  const sep = db.includes("?") ? "&" : "?";
  const url = /search_path/i.test(db) ? db : `${db}${sep}options=-csearch_path%3Dlegcal`;
  const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 15 });
  try {
    let upserted = 0;
    for (const ev of events) {
      const bills = JSON.stringify(ev.bills || []);
      await sql`
        INSERT INTO calendar_events (
          source, source_id, state, title, start_at, end_at, all_day,
          location, chamber, url, bills, description, raw, first_seen_at, last_seen_at
        )
        VALUES (
          'sa', ${String(ev.sourceId)}, ${String(ev.state)}, ${String(ev.title)}, ${String(ev.start)}, ${String(ev.end || "")},
          ${Boolean(ev.allDay)}, ${String(ev.location || "")}, ${String(ev.chamber || "")}, ${String(ev.url || "")},
          ${bills}, ${String(ev.description || "")}, ${JSON.stringify(ev.raw ?? {})}, NOW(), NOW()
        )
        ON CONFLICT (source, state, source_id) DO UPDATE SET
          title = EXCLUDED.title,
          start_at = EXCLUDED.start_at,
          end_at = EXCLUDED.end_at,
          location = EXCLUDED.location,
          chamber = EXCLUDED.chamber,
          url = EXCLUDED.url,
          bills = EXCLUDED.bills,
          description = EXCLUDED.description,
          last_seen_at = NOW()
      `;
      upserted += 1;
    }
    console.log(JSON.stringify({ db: "ok", upserted }));
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ db: "error", error: /postgres(ql)?:\/\//i.test(msg) ? "query-failed" : msg.slice(0, 180) }));
    return false;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

(async () => {
  loadEnvLocal();
  const token = secret();
  if (!token) throw new Error("Need INGEST_SECRET in .env.local to push meetings.");
  const states = process.argv.slice(2).map((s) => s.toUpperCase()).filter(Boolean);
  const cache = JSON.parse(readFileSync(path.join(root, "data", "sa-meetings-cache.json"), "utf8"));
  const events = (cache.events || []).filter((e) => !states.length || states.includes(String(e.state || "").toUpperCase()));
  const scrapedStates = states.length ? states : [...new Set(events.map((e) => e.state))];
  await upsertSupabase(events);
  const base = KEEP_URL.replace(/\/$/, "");
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };

  let ingestOk = false;
  for (const state of scrapedStates) {
    const hearings = events.filter((e) => String(e.state || "").toUpperCase() === state);
    const ingest = await fetch(`${base}/api/ingest/sa`, {
      method: "POST",
      headers,
      body: JSON.stringify({ state, hearings }),
    });
    const ingestData = await ingest.json().catch(() => ({}));
    console.log(
      JSON.stringify({
        ingest: ingest.status,
        ok: ingestData.ok,
        state,
        upserted: ingestData.upserted,
        openGaps: ingestData.openGaps,
        error: ingestData.error || "",
        pushed: hearings.length,
      }),
    );
    if (ingest.ok) ingestOk = true;
  }

  const refresh = await fetch(`${base}/api/sa/meetings`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "refresh",
      states: scrapedStates.join(","),
      force: true,
    }),
  });
  const refreshData = await refresh.json().catch(() => ({}));
  console.log(
    JSON.stringify({
      refresh: refresh.status,
      ok: refreshData.ok,
      events: refreshData.events,
      skipped: refreshData.skipped,
      reason: refreshData.reason || "",
      error: refreshData.error || "",
    }),
  );
  if (!ingestOk && !refresh.ok) process.exit(1);
})().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
