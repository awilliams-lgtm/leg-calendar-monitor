import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let sql: NeonQueryFunction<false, false> | null = null;
let schemaReady = false;

export function databaseUrl(): string | null {
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING;
  return url?.trim() || null;
}

export function getSql() {
  const url = databaseUrl();
  if (!url) {
    throw new Error(
      "Missing DATABASE_URL. Add a Neon database in Vercel Storage and set DATABASE_URL.",
    );
  }
  if (!sql) sql = neon(url);
  return sql;
}

export async function ensureSchema() {
  if (schemaReady) return;
  const q = getSql();

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

  schemaReady = true;
}
