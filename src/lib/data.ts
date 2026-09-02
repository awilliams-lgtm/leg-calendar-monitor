import { ensureSchema, getSql } from "@/lib/db";
import { MATCH_THRESHOLD, bestMatch, eventDateKey, extractBills } from "@/lib/match";
import { STATE_SOURCES } from "@/lib/states";
import { officialHandledKey, inMonth, summarizeState, toCalendarItems } from "@/lib/calendar";
import { monthBounds } from "@/lib/dates";
import type {
  CalendarEvent,
  CalendarItem,
  GapRow,
  NotificationRow,
  StateCoverage,
  StateMonthSummary,
} from "@/lib/types";

function parseBills(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function upcomingCutoff(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function upsertEvents(
  source: "official" | "sa",
  state: string,
  events: CalendarEvent[],
): Promise<{ upserted: number; newIds: string[] }> {
  await ensureSchema();
  const q = getSql();
  const newIds: string[] = [];
  let upserted = 0;
  for (const ev of events) {
    const bills = JSON.stringify(ev.bills || []);
    const raw = JSON.stringify(ev.raw ?? {});
    const rows = (await q`
      INSERT INTO calendar_events (
        source, source_id, state, title, start_at, end_at, all_day,
        location, chamber, url, bills, description, raw, first_seen_at, last_seen_at
      )
      VALUES (
        ${source}, ${ev.sourceId}, ${state}, ${ev.title}, ${ev.start}, ${ev.end || ""},
        ${Boolean(ev.allDay)}, ${ev.location || ""}, ${ev.chamber || ""}, ${ev.url || ""},
        ${bills}, ${ev.description || ""}, ${raw}, NOW(), NOW()
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
        raw = EXCLUDED.raw,
        last_seen_at = NOW()
      RETURNING source_id, (xmax = 0) AS inserted
    `) as Array<{ source_id: string; inserted: boolean }>;
    upserted += 1;
    if (rows[0]?.inserted) newIds.push(ev.sourceId);
  }
  return { upserted, newIds };
}

export async function recordSyncRun(state: string, source: string, upserted: number, error = "") {
  await ensureSchema();
  const q = getSql();
  await q`
    INSERT INTO sync_runs (state, source, started_at, finished_at, upserted, error)
    VALUES (${state}, ${source}, NOW(), NOW(), ${upserted}, ${error})
  `;
}

export async function getMeta(key: string): Promise<string> {
  await ensureSchema();
  const q = getSql();
  const rows = (await q`SELECT value FROM sync_meta WHERE key = ${key}`) as Array<{ value: string }>;
  return rows[0]?.value || "";
}

export async function setMeta(key: string, value: string) {
  await ensureSchema();
  const q = getSql();
  await q`
    INSERT INTO sync_meta (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}

export async function allEventsForSource(source: "official" | "sa"): Promise<CalendarEvent[]> {
  await ensureSchema();
  const q = getSql();
  const rows = (await q`
    SELECT source_id, state, title, start_at, location, chamber, url, bills, description
    FROM calendar_events
    WHERE source = ${source}
    ORDER BY start_at ASC
  `) as Array<{
    source_id: string;
    state: string;
    title: string;
    start_at: string;
    location: string;
    chamber: string;
    url: string;
    bills: string;
    description: string;
  }>;
  return rows.map((r) => ({
    sourceId: r.source_id,
    state: r.state,
    title: r.title,
    start: r.start_at,
    location: r.location,
    chamber: r.chamber,
    url: r.url,
    bills: parseBills(r.bills),
    description: r.description || "",
  }));
}

export async function eventsForState(source: "official" | "sa", state: string) {
  await ensureSchema();
  const q = getSql();
  const rows = (await q`
    SELECT source_id, title, start_at, location, chamber, url, bills
    FROM calendar_events
    WHERE source = ${source} AND state = ${state}
    ORDER BY start_at ASC
  `) as Array<{
    source_id: string;
    title: string;
    start_at: string;
    location: string;
    chamber: string;
    url: string;
    bills: string;
  }>;
  return rows.map((r) => ({
    sourceId: r.source_id,
    state,
    title: r.title,
    start: r.start_at,
    location: r.location,
    chamber: r.chamber,
    url: r.url,
    bills: parseBills(r.bills),
  }));
}

export async function compareState(state: string): Promise<{ newGaps: number; openGaps: number }> {
  await ensureSchema();
  const q = getSql();
  const [official, sa] = await Promise.all([eventsForState("official", state), eventsForState("sa", state)]);
  const cutoff = upcomingCutoff();
  const seenOfficial = new Set<string>();
  let newGaps = 0;

  for (const ev of official) {
    const day = eventDateKey(ev.start);
    if (!day || day < cutoff) continue;
    seenOfficial.add(ev.sourceId);
    const match = bestMatch(ev, sa);
    const missing = match.score < MATCH_THRESHOLD;
    if (!missing) {
      await q`
        UPDATE calendar_gaps
        SET status = 'matched', best_score = ${match.score}, sa_match_title = ${match.title}, updated_at = NOW()
        WHERE state = ${state} AND official_source_id = ${ev.sourceId} AND status = 'open'
      `;
      continue;
    }
    const bills = JSON.stringify(ev.bills || []);
    const inserted = (await q`
      INSERT INTO calendar_gaps (
        state, official_source_id, title, start_at, location, chamber, url, bills,
        status, best_score, sa_match_title, created_at, updated_at
      )
      VALUES (
        ${state}, ${ev.sourceId}, ${ev.title}, ${ev.start}, ${ev.location || ""},
        ${ev.chamber || ""}, ${ev.url || ""}, ${bills}, 'open', ${match.score}, ${match.title}, NOW(), NOW()
      )
      ON CONFLICT (state, official_source_id) DO UPDATE SET
        title = EXCLUDED.title,
        start_at = EXCLUDED.start_at,
        location = EXCLUDED.location,
        chamber = EXCLUDED.chamber,
        url = EXCLUDED.url,
        bills = EXCLUDED.bills,
        best_score = EXCLUDED.best_score,
        sa_match_title = EXCLUDED.sa_match_title,
        updated_at = NOW(),
        status = CASE WHEN calendar_gaps.status = 'dismissed' THEN calendar_gaps.status ELSE 'open' END
      RETURNING id, (xmax = 0) AS inserted
    `) as Array<{ id: number; inserted: boolean }>;
    if (inserted[0]?.inserted) newGaps += 1;
  }

  if (seenOfficial.size) {
    await q`
      UPDATE calendar_gaps
      SET status = 'matched', updated_at = NOW()
      WHERE state = ${state}
        AND status = 'open'
        AND official_source_id NOT IN (
          SELECT source_id FROM calendar_events WHERE source = 'official' AND state = ${state}
        )
    `;
  }

  const open = (await q`
    SELECT COUNT(*)::int AS n FROM calendar_gaps WHERE state = ${state} AND status = 'open'
  `) as Array<{ n: number }>;
  return { newGaps, openGaps: open[0]?.n || 0 };
}

export async function insertNotification(input: {
  kind: "new_official" | "missing_on_sa";
  state: string;
  sourceId: string;
  title: string;
  start: string;
  url: string;
}): Promise<boolean> {
  await ensureSchema();
  const q = getSql();
  const rows = (await q`
    INSERT INTO calendar_notifications (kind, state, source_id, title, start_at, url, created_at)
    VALUES (${input.kind}, ${input.state}, ${input.sourceId}, ${input.title}, ${input.start}, ${input.url}, NOW())
    ON CONFLICT (kind, state, source_id) DO NOTHING
    RETURNING id
  `) as Array<{ id: number }>;
  return Boolean(rows[0]?.id);
}

export async function coverageByState(): Promise<StateCoverage[]> {
  await ensureSchema();
  const q = getSql();
  const official = (await q`
    SELECT state, COUNT(*)::int AS n, MAX(last_seen_at)::text AS last
    FROM calendar_events WHERE source = 'official' GROUP BY state
  `) as Array<{ state: string; n: number; last: string }>;
  const sa = (await q`
    SELECT state, COUNT(*)::int AS n, MAX(last_seen_at)::text AS last
    FROM calendar_events WHERE source = 'sa' GROUP BY state
  `) as Array<{ state: string; n: number; last: string }>;
  const gaps = (await q`
    SELECT state, COUNT(*)::int AS n FROM calendar_gaps WHERE status = 'open' GROUP BY state
  `) as Array<{ state: string; n: number }>;
  const errors = (await q`
    SELECT DISTINCT ON (state) state, error, started_at::text AS at
    FROM sync_runs ORDER BY state, started_at DESC
  `) as Array<{ state: string; error: string; at: string }>;

  const oMap = new Map(official.map((r) => [r.state, r]));
  const sMap = new Map(sa.map((r) => [r.state, r]));
  const gMap = new Map(gaps.map((r) => [r.state, r.n]));
  const eMap = new Map(errors.map((r) => [r.state, r]));

  return STATE_SOURCES.map((src) => ({
    code: src.code,
    name: src.name,
    officialUrl: src.officialUrl,
    officialCount: oMap.get(src.code)?.n || 0,
    saCount: sMap.get(src.code)?.n || 0,
    openGaps: gMap.get(src.code) || 0,
    lastOfficialSync: oMap.get(src.code)?.last || "",
    lastSaSync: sMap.get(src.code)?.last || "",
    lastError: eMap.get(src.code)?.error || "",
  }));
}

export async function listGaps(opts: { state?: string; status?: string; limit?: number }): Promise<GapRow[]> {
  await ensureSchema();
  const q = getSql();
  const status = opts.status || "open";
  const limit = Math.min(opts.limit || 200, 500);
  const rows = opts.state
    ? ((await q`
        SELECT id, state, official_source_id, title, start_at, location, chamber, url, bills,
               status, best_score, sa_match_title, created_at::text AS created_at
        FROM calendar_gaps
        WHERE status = ${status} AND state = ${opts.state}
        ORDER BY start_at ASC
        LIMIT ${limit}
      `) as Array<Record<string, unknown>>)
    : ((await q`
        SELECT id, state, official_source_id, title, start_at, location, chamber, url, bills,
               status, best_score, sa_match_title, created_at::text AS created_at
        FROM calendar_gaps
        WHERE status = ${status}
        ORDER BY start_at ASC
        LIMIT ${limit}
      `) as Array<Record<string, unknown>>);

  return rows.map((r) => ({
    id: Number(r.id),
    state: String(r.state),
    officialSourceId: String(r.official_source_id),
    title: String(r.title),
    start: String(r.start_at),
    location: String(r.location || ""),
    chamber: String(r.chamber || ""),
    url: String(r.url || ""),
    bills: [...new Set([...parseBills(r.bills), ...extractBills(String(r.title || ""))])],
    status: (r.status as GapRow["status"]) || "open",
    score: Number(r.best_score || 0),
    createdAt: String(r.created_at || ""),
    saMatchTitle: String(r.sa_match_title || ""),
  }));
}

export async function setGapStatus(id: number, status: "open" | "dismissed") {
  await ensureSchema();
  const q = getSql();
  await q`UPDATE calendar_gaps SET status = ${status}, updated_at = NOW() WHERE id = ${id}`;
}

export async function dismissedOfficialKeysFromDb(): Promise<string[]> {
  await ensureSchema();
  const q = getSql();
  const rows = (await q`
    SELECT state, official_source_id
    FROM calendar_gaps
    WHERE status = 'dismissed'
  `) as Array<{ state: string; official_source_id: string }>;
  return rows.map((r) => officialHandledKey(r.state, r.official_source_id));
}

export async function listNotifications(unreadOnly = false): Promise<NotificationRow[]> {
  await ensureSchema();
  const q = getSql();
  const rows = unreadOnly
    ? ((await q`
        SELECT id, kind, state, title, start_at, url, created_at::text AS created_at,
               COALESCE(read_at::text, '') AS read_at, COALESCE(emailed_at::text, '') AS emailed_at
        FROM calendar_notifications
        WHERE read_at IS NULL
        ORDER BY created_at DESC
        LIMIT 200
      `) as Array<Record<string, string | number>>)
    : ((await q`
        SELECT id, kind, state, title, start_at, url, created_at::text AS created_at,
               COALESCE(read_at::text, '') AS read_at, COALESCE(emailed_at::text, '') AS emailed_at
        FROM calendar_notifications
        ORDER BY created_at DESC
        LIMIT 200
      `) as Array<Record<string, string | number>>);
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind as NotificationRow["kind"],
    state: String(r.state),
    title: String(r.title),
    start: String(r.start_at),
    url: String(r.url),
    createdAt: String(r.created_at),
    readAt: String(r.read_at || ""),
    emailedAt: String(r.emailed_at || ""),
  }));
}

export async function markNotificationsRead() {
  await ensureSchema();
  const q = getSql();
  await q`UPDATE calendar_notifications SET read_at = NOW() WHERE read_at IS NULL`;
}

export async function unreadCount(): Promise<number> {
  await ensureSchema();
  const q = getSql();
  const rows = (await q`SELECT COUNT(*)::int AS n FROM calendar_notifications WHERE read_at IS NULL`) as Array<{
    n: number;
  }>;
  return rows[0]?.n || 0;
}

export async function dashboardStats() {
  await ensureSchema();
  const q = getSql();
  const [gaps, notes, official, sa] = await Promise.all([
    q`SELECT COUNT(*)::int AS n FROM calendar_gaps WHERE status = 'open'`,
    q`SELECT COUNT(*)::int AS n FROM calendar_notifications WHERE read_at IS NULL`,
    q`SELECT COUNT(*)::int AS n FROM calendar_events WHERE source = 'official'`,
    q`SELECT COUNT(*)::int AS n FROM calendar_events WHERE source = 'sa'`,
  ]);
  const n = (rows: Array<Record<string, unknown>>) => Number(rows[0]?.n || 0);
  return {
    openGaps: n(gaps),
    unread: n(notes),
    officialEvents: n(official),
    saEvents: n(sa),
  };
}

function rowToEvent(r: {
  source_id: string;
  state?: string;
  title: string;
  start_at: string;
  location: string;
  chamber: string;
  url: string;
  bills: string;
}): CalendarEvent {
  return {
    sourceId: r.source_id,
    state: r.state || "",
    title: r.title,
    start: r.start_at,
    location: r.location,
    chamber: r.chamber,
    url: r.url,
    bills: parseBills(r.bills),
  };
}

export async function listCalendar(state: string, month: string): Promise<CalendarItem[]> {
  const { loadHandledOfficialKeys } = await import("@/lib/handled");
  const [official, sa, handled] = await Promise.all([
    eventsForState("official", state),
    eventsForState("sa", state),
    loadHandledOfficialKeys(),
  ]);
  return toCalendarItems(official, sa, handled).filter((ev) => inMonth(ev.start, month));
}

export async function monthOverview(month: string): Promise<StateMonthSummary[]> {
  await ensureSchema();
  const q = getSql();
  const { start, end } = monthBounds(month);
  const rows = (await q`
    SELECT source, source_id, state, title, start_at, location, chamber, url, bills
    FROM calendar_events
    WHERE start_at >= ${start} AND start_at < ${end}
  `) as Array<{
    source: string;
    source_id: string;
    state: string;
    title: string;
    start_at: string;
    location: string;
    chamber: string;
    url: string;
    bills: string;
  }>;

  const officialByState = new Map<string, CalendarEvent[]>();
  const saByState = new Map<string, CalendarEvent[]>();
  for (const r of rows) {
    const ev = rowToEvent(r);
    const bucket = r.source === "sa" ? saByState : officialByState;
    const list = bucket.get(r.state) || [];
    list.push(ev);
    bucket.set(r.state, list);
  }

  const { loadHandledOfficialKeys } = await import("@/lib/handled");
  const handled = await loadHandledOfficialKeys();
  return STATE_SOURCES.map((src) => {
    const items = toCalendarItems(officialByState.get(src.code) || [], saByState.get(src.code) || [], handled);
    return summarizeState(
      src.code,
      src.name,
      src.officialUrl,
      items,
      (saByState.get(src.code) || []).length,
    );
  });
}
