import { readFileSync, existsSync } from "fs";
import path from "path";
import postgres from "postgres";

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
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
}

function stripQuotes(value) {
  let v = String(value || "").trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v;
}

function hostOf(url) {
  try {
    return new URL(url.replace(/^postgres(ql)?:/i, "http:")).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function candidateUrls() {
  const out = [];
  for (const key of ["DATABASE_URL", "POSTGRES_URL_NON_POOLING", "POSTGRES_PRISMA_URL", "POSTGRES_URL"]) {
    const value = stripQuotes(process.env[key] || "");
    if (value.length < 24) {
      if (value) console.log("Skipping", key, "(too short to be a postgres URL)");
      continue;
    }
    if (!/^postgres(ql)?:\/\//i.test(value)) {
      console.log("Skipping", key, "(not a postgres URL)");
      continue;
    }
    out.push({ key, value, host: hostOf(value) });
  }
  const hasSupabase = out.some((row) => row.host.includes("supabase"));
  if (hasSupabase) {
    return out.filter((row) => row.host.includes("supabase"));
  }
  return out;
}

loadEnvLocal();

const raw = readFileSync("data/sa-session.json", "utf8");
const session = JSON.parse(raw);
if (!session.cookie && !session.bearer) throw new Error("Local SA session has no cookie or token");

const urls = candidateUrls();
if (!urls.length) throw new Error("No writable postgres URL found (need Supabase DATABASE_URL)");

let lastError = "";
for (const { key, value } of urls) {
  const sql = postgres(value, { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 15 });
  try {
    try {
      await sql`
        INSERT INTO legcal.sync_meta (key, value) VALUES ('sa_session', ${raw})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/read-only/i.test(message)) throw err;
      await sql`
        INSERT INTO sync_meta (key, value) VALUES ('sa_session', ${raw})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `;
    }
    console.log("Stored local SA session in Postgres via", key);
    await sql.end({ timeout: 2 });
    process.exit(0);
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    await sql.end({ timeout: 2 }).catch(() => undefined);
    if (!/read-only/i.test(lastError)) throw err;
    console.log("Skipped read-only database via", key);
  }
}

throw new Error(lastError || "Could not write sa_session");
