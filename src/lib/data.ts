import { ensureSchema, getSql } from "@/lib/db";
import { MATCH_THRESHOLD, bestMatch, eventDateKey, extractBills } from "@/lib/match";
import { filterUnconfirmed, findReviewMatch, type ReviewConfirmation } from "@/lib/review";
import { STATE_SOURCES } from "@/lib/states";
import { officialHandledKey, inMonth, summarizeState, toCalendarItems } from "@/lib/calendar";
import { parseEventRaw, serializeEventRaw } from "@/lib/event-raw";
import { isClosedFacilityNotice, junkOfficialEvent, usableOfficialEvents, usableSaEvents } from "@/lib/title";
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
    const raw = serializeEventRaw(ev.raw);
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
        raw = CASE
          WHEN EXCLUDED.raw IS NULL OR btrim(EXCLUDED.raw) IN ('', '{}', '[]', 'null', '""') THEN calendar_events.raw
          WHEN calendar_events.raw IS NULL OR btrim(calendar_events.raw) IN ('', '{}', '[]', 'null', '""') THEN EXCLUDED.raw
          WHEN length(EXCLUDED.raw) >= length(calendar_events.raw) THEN EXCLUDED.raw
          ELSE calendar_events.raw
        END,
        last_seen_at = NOW()
      RETURNING source_id, (xmax = 0) AS inserted
    `) as Array<{ source_id: string; inserted: boolean }>;
    upserted += 1;
    if (rows[0]?.inserted) newIds.push(ev.sourceId);
  }
  return { upserted, newIds };
}

export async function replaceOfficialEvents(
  state: string,
  events: CalendarEvent[],
): Promise<{ upserted: number; newIds: string[] }> {
  const existing = await eventsForState("official", state);
  const { foldOfficialIncoming } = await import("@/lib/official-merge");
  const folded = foldOfficialIncoming(existing, events).filter((e) => !junkOfficialEvent(e));
  const kept = new Set(folded.map((e) => e.sourceId));
  const drop = existing.filter((e) => e.sourceId && !kept.has(e.sourceId) && junkOfficialEvent(e));
  if (drop.length) {
    await ensureSchema();
    const q = getSql();
    const ids = drop.map((e) => e.sourceId);
    await q`DELETE FROM calendar_events WHERE source = 'official' AND state = ${state} AND source_id = ANY(${ids})`;
    await q`UPDATE calendar_gaps SET status = 'matched', updated_at = NOW()
      WHERE state = ${state} AND official_source_id = ANY(${ids}) AND status = 'open'`;
    await q`DELETE FROM calendar_notifications WHERE state = ${state} AND source_id = ANY(${ids})`;
  }
  return upsertEvents("official", state, folded);
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
    SELECT source_id, state, title, start_at, location, chamber, url, bills, description, raw
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
    raw: string;
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
    raw: parseEventRaw(r.raw),
  }));
}

export async function eventsForState(source: "official" | "sa", state: string) {
  await ensureSchema();
  const q = getSql();
  const rows = (await q`
    SELECT source_id, title, start_at, location, chamber, url, bills, description, raw
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
    description: string;
    raw: string;
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
    description: r.description || "",
    raw: parseEventRaw(r.raw),
  }));
}

export async function compareState(state: string): Promise<{ newGaps: number; openGaps: number }> {
  await ensureSchema();
  const q = getSql();
  const official = usableOfficialEvents(await eventsForState("official", state));
  const sa = usableSaEvents(await eventsForState("sa", state));
  const cutoff = upcomingCutoff();
  const seenOfficial = new Set<string>();
  let newGaps = 0;
  const confirmed = await reviewConfirmationsFromDb(state);

  for (const ev of official) {
    const day = eventDateKey(ev.start);
    if (!day || day < cutoff) continue;
    seenOfficial.add(ev.sourceId);
    const match = bestMatch(ev, sa);
    const missing = match.score < MATCH_THRESHOLD;
    const prior = findReviewMatch(ev, confirmed);
    if (prior) {
      const bills = JSON.stringify(ev.bills || []);
      await q`
        INSERT INTO calendar_gaps (
          state, official_source_id, title, start_at, location, chamber, url, bills,
          status, best_score, sa_match_title, created_at, updated_at
        )
        VALUES (
          ${state}, ${ev.sourceId}, ${ev.title}, ${ev.start}, ${ev.location || ""},
          ${ev.chamber || ""}, ${ev.url || ""}, ${bills}, ${prior.status}, ${match.score}, ${match.title}, NOW(), NOW()
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
          status = CASE
            WHEN calendar_gaps.status IN ('dismissed', 'irrelevant') THEN calendar_gaps.status
            ELSE EXCLUDED.status
          END
      `;
      if (!confirmed.some((row) => row.officialSourceId === ev.sourceId && row.status === prior.status)) {
        confirmed.push({
          state,
          officialSourceId: ev.sourceId,
          title: ev.title,
          start: ev.start,
          chamber: ev.chamber || "",
          status: prior.status,
        });
      }
      continue;
    }
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
        status = CASE
          WHEN calendar_gaps.status IN ('dismissed', 'irrelevant') THEN calendar_gaps.status
          ELSE 'open'
        END
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

export async function listGaps(opts: {
  state?: string;
  status?: string;
  month?: string;
  limit?: number;
}): Promise<GapRow[]> {
  await ensureSchema();
  const q = getSql();
  const status = opts.status || "open";
  const limit = Math.min(opts.limit || 200, 500);
  const monthLike = opts.month ? `${opts.month}%` : "";
  const rows = (
    opts.state && monthLike
      ? await q`
        SELECT id, state, official_source_id, title, start_at, location, chamber, url, bills,
               status, best_score, sa_match_title, created_at::text AS created_at
        FROM calendar_gaps
        WHERE status = ${status} AND state = ${opts.state} AND start_at LIKE ${monthLike}
        ORDER BY start_at ASC
        LIMIT ${limit}
      `
      : opts.state
        ? await q`
        SELECT id, state, official_source_id, title, start_at, location, chamber, url, bills,
               status, best_score, sa_match_title, created_at::text AS created_at
        FROM calendar_gaps
        WHERE status = ${status} AND state = ${opts.state}
        ORDER BY start_at ASC
        LIMIT ${limit}
      `
        : monthLike
          ? await q`
        SELECT id, state, official_source_id, title, start_at, location, chamber, url, bills,
               status, best_score, sa_match_title, created_at::text AS created_at
        FROM calendar_gaps
        WHERE status = ${status} AND start_at LIKE ${monthLike}
        ORDER BY start_at ASC
        LIMIT ${limit}
      `
          : await q`
        SELECT id, state, official_source_id, title, start_at, location, chamber, url, bills,
               status, best_score, sa_match_title, created_at::text AS created_at
        FROM calendar_gaps
        WHERE status = ${status}
        ORDER BY start_at ASC
        LIMIT ${limit}
      `
  ) as Array<Record<string, unknown>>;

  const mapped = rows
    .filter((r) => !isClosedFacilityNotice(String(r.title || "")))
    .map((r) => ({
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

  if (status !== "open") return mapped;
  try {
    const confirmed = await reviewConfirmationsFromDb(
      opts.state,
      opts.state ? undefined : [...new Set(mapped.map((gap) => gap.state))],
    );
    return filterUnconfirmed(mapped, confirmed);
  } catch {
    return mapped;
  }
}

export async function setGapStatus(
  id: number,
  status: "open" | "dismissed" | "irrelevant",
  opts?: { state?: string; officialSourceId?: string },
) {
  await ensureSchema();
  const q = getSql();
  await q`UPDATE calendar_gaps SET status = ${status}, updated_at = NOW() WHERE id = ${id}`;
  if (opts?.state && opts.officialSourceId) {
    await q`
      UPDATE calendar_gaps
      SET status = ${status}, updated_at = NOW()
      WHERE state = ${opts.state} AND official_source_id = ${opts.officialSourceId}
    `;
  }
}

export async function reviewConfirmationsFromDb(state?: string, states?: string[]): Promise<ReviewConfirmation[]> {
  await ensureSchema();
  const q = getSql();
  const scoped = states?.filter(Boolean).map((code) => code.toUpperCase()) || [];
  const rows = (
    state
      ? await q`
        SELECT state, official_source_id, title, start_at, chamber, status
        FROM calendar_gaps
        WHERE status IN ('dismissed', 'irrelevant') AND state = ${state}
      `
      : scoped.length
        ? await q`
        SELECT state, official_source_id, title, start_at, chamber, status
        FROM calendar_gaps
        WHERE status IN ('dismissed', 'irrelevant') AND state = ANY(${scoped})
      `
      : await q`
        SELECT state, official_source_id, title, start_at, chamber, status
        FROM calendar_gaps
        WHERE status IN ('dismissed', 'irrelevant')
      `
  ) as Array<{
    state: string;
    official_source_id: string;
    title: string;
    start_at: string;
    chamber: string;
    status: string;
  }>;
  return rows.map((r) => ({
    state: r.state,
    officialSourceId: r.official_source_id,
    title: r.title || "",
    start: r.start_at || "",
    chamber: r.chamber || "",
    status: r.status === "irrelevant" ? "irrelevant" : "dismissed",
  }));
}

export async function dismissedOfficialKeysFromDb(): Promise<string[]> {
  const rows = (await reviewConfirmationsFromDb()).filter((r) => r.status === "dismissed");
  return rows.map((r) => officialHandledKey(r.state, r.officialSourceId));
}

export async function irrelevantOfficialKeysFromDb(): Promise<string[]> {
  const rows = (await reviewConfirmationsFromDb()).filter((r) => r.status === "irrelevant");
  return rows.map((r) => officialHandledKey(r.state, r.officialSourceId));
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
  return rows
    .filter((r) => !isClosedFacilityNotice(String(r.title || "")))
    .map((r) => ({
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
  const gaps = await q`SELECT COUNT(*)::int AS n FROM calendar_gaps WHERE status = 'open'`;
  const notes = await q`SELECT COUNT(*)::int AS n FROM calendar_notifications WHERE read_at IS NULL`;
  const official = await q`SELECT COUNT(*)::int AS n FROM calendar_events WHERE source = 'official'`;
  const sa = await q`SELECT COUNT(*)::int AS n FROM calendar_events WHERE source = 'sa'`;
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

export async function eventsInRange(month?: string): Promise<{ official: CalendarEvent[]; sa: CalendarEvent[] }> {
  await ensureSchema();
  const q = getSql();
  const prefix = month && /^\d{4}-\d{2}$/.test(month) ? `${month}%` : "";
  const rows = (
    prefix
      ? await q`
        SELECT source, source_id, state, title, start_at, location, chamber, url, bills
        FROM calendar_events
        WHERE start_at LIKE ${prefix}
      `
      : await q`
        SELECT source, source_id, state, title, start_at, location, chamber, url, bills
        FROM calendar_events
      `
  ) as Array<{
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
  const official: CalendarEvent[] = [];
  const sa: CalendarEvent[] = [];
  for (const r of rows) {
    const ev = rowToEvent(r);
    if (r.source === "sa") sa.push(ev);
    else if (r.source === "official") official.push(ev);
  }
  return { official, sa };
}

export async function eventMonthKeys(): Promise<string[]> {
  await ensureSchema();
  const q = getSql();
  const rows = (await q`
    SELECT DISTINCT left(start_at, 7) AS month
    FROM calendar_events
    WHERE start_at ~ '^[0-9]{4}-[0-9]{2}'
    ORDER BY month DESC
  `) as Array<{ month: string }>;
  return rows.map((r) => r.month).filter((m) => /^\d{4}-\d{2}$/.test(m));
}

export async function calendarFeedStats() {
  await ensureSchema();
  const q = getSql();
  const from = upcomingCutoff();
  const official = await q`SELECT COUNT(*)::int AS n, MAX(last_seen_at)::text AS updated FROM calendar_events WHERE source = 'official'`;
  const sa = await q`SELECT COUNT(*)::int AS n, MAX(last_seen_at)::text AS updated FROM calendar_events WHERE source = 'sa'`;
  const upcoming = await q`SELECT COUNT(*)::int AS n FROM calendar_events WHERE source = 'sa' AND start_at >= ${from}`;
  const saStates = await q`SELECT COUNT(DISTINCT state)::int AS n FROM calendar_events WHERE source = 'sa'`;
  const n = (rows: Array<Record<string, unknown>>) => Number(rows[0]?.n || 0);
  const updated = (rows: Array<Record<string, unknown>>) => String(rows[0]?.updated || "");
  return {
    officialEvents: n(official),
    officialUpdatedAt: updated(official),
    saEvents: n(sa),
    saUpdatedAt: updated(sa),
    upcoming: n(upcoming),
    saStates: n(saStates),
  };
}

export async function listCalendar(state: string, month: string): Promise<CalendarItem[]> {
  const { expandReviewKeysFor, loadReviewOfficialKeys } = await import("@/lib/handled");
  const official = await eventsForState("official", state);
  const sa = await eventsForState("sa", state);
  const keys = expandReviewKeysFor(await loadReviewOfficialKeys(), official);
  return toCalendarItems(official, sa, keys.handled, keys.irrelevant).filter(
    (ev) => inMonth(ev.start, month) && !ev.irrelevant,
  );
}

export async function monthOverview(month: string): Promise<StateMonthSummary[]> {
  const { official, sa } = await eventsInRange(month);
  const officialByState = new Map<string, CalendarEvent[]>();
  const saByState = new Map<string, CalendarEvent[]>();
  for (const ev of official) {
    const list = officialByState.get(ev.state) || [];
    list.push(ev);
    officialByState.set(ev.state, list);
  }
  for (const ev of sa) {
    const list = saByState.get(ev.state) || [];
    list.push(ev);
    saByState.set(ev.state, list);
  }

  const { expandReviewKeysFor, loadReviewOfficialKeys } = await import("@/lib/handled");
  const keys = expandReviewKeysFor(await loadReviewOfficialKeys(), official);
  return STATE_SOURCES.map((src) => {
    const items = toCalendarItems(
      officialByState.get(src.code) || [],
      saByState.get(src.code) || [],
      keys.handled,
      keys.irrelevant,
    );
    return summarizeState(
      src.code,
      src.name,
      src.officialUrl,
      items,
      usableSaEvents(saByState.get(src.code) || []).length,
    );
  });
}
