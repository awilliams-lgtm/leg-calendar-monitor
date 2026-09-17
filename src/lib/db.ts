import postgres, { type Sql } from "postgres";
import { envVar } from "@/lib/env";

let sql: Sql | null = null;
let schemaReady = false;

export function databaseUrl(): string | null {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_PRISMA_URL,
  ];
  for (const url of candidates) {
    const trimmed = url?.trim() || "";
    if (/^postgres(ql)?:\/\//i.test(trimmed)) return trimmed;
  }
  return null;
}

/** Hosted Vercel reads and writes calendars through Postgres, not the ephemeral /tmp file. */
export function hostedDatabase(): boolean {
  return Boolean(databaseUrl() && envVar("VERCEL"));
}

export function getSql() {
  const url = databaseUrl();
  if (!url) {
    throw new Error("Missing DATABASE_URL. Set the Supabase Postgres URL in the server environment.");
  }
  // Supabase transaction pooler: no prepared statements, one connection per lambda.
  if (!sql) {
    sql = postgres(url, {
      prepare: false,
      max: 1,
      idle_timeout: 20,
      connect_timeout: 15,
      ssl: "require",
    });
  }
  return sql;
}

export async function ensureSchema() {
  if (schemaReady) return;
  const q = getSql();
  try {
    await q`SELECT 1 FROM calendar_events LIMIT 1`;
    schemaReady = true;
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/must be owner/i.test(msg)) {
      schemaReady = true;
      return;
    }
    if (!/does not exist|relation/i.test(msg)) throw err;
  }

  try {
  await q`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      state TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      start_at TEXT NOT NULL DEFAULT '',
      end_at TEXT NOT NULL DEFAULT '',
      all_day BOOLEAN NOT NULL DEFAULT FALSE,
      location TEXT NOT NULL DEFAULT '',
      chamber TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      bills TEXT NOT NULL DEFAULT '[]',
      description TEXT NOT NULL DEFAULT '',
      raw TEXT NOT NULL DEFAULT '{}',
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (source, state, source_id)
    )
  `;
  await q`CREATE INDEX IF NOT EXISTS idx_cal_events_state_source ON calendar_events(state, source, start_at)`;
  await q`CREATE INDEX IF NOT EXISTS idx_cal_events_start ON calendar_events(start_at)`;

  await q`
    CREATE TABLE IF NOT EXISTS calendar_gaps (
      id BIGSERIAL PRIMARY KEY,
      state TEXT NOT NULL,
      official_source_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      start_at TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      chamber TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      bills TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'open',
      best_score REAL NOT NULL DEFAULT 0,
      sa_match_title TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (state, official_source_id)
    )
  `;
  await q`CREATE INDEX IF NOT EXISTS idx_cal_gaps_status ON calendar_gaps(status, state, start_at)`;

  await q`
    CREATE TABLE IF NOT EXISTS calendar_notifications (
      id BIGSERIAL PRIMARY KEY,
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      source_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      start_at TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      read_at TIMESTAMPTZ,
      emailed_at TIMESTAMPTZ,
      UNIQUE (kind, state, source_id)
    )
  `;
  await q`CREATE INDEX IF NOT EXISTS idx_cal_notes_created ON calendar_notifications(created_at DESC)`;

  await q`
    CREATE TABLE IF NOT EXISTS sync_runs (
      id BIGSERIAL PRIMARY KEY,
      state TEXT NOT NULL,
      source TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      upserted INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT ''
    )
  `;
  await q`CREATE INDEX IF NOT EXISTS idx_sync_runs_state ON sync_runs(state, started_at DESC)`;

  await q`
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )
  `;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/must be owner/i.test(msg)) throw err;
  }

  schemaReady = true;
}
