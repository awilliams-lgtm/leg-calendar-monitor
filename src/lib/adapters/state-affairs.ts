import { readFile } from "fs/promises";
import path from "path";
import type { CalendarEvent } from "@/lib/types";
import { upcomingWindow } from "@/lib/dates";
import { isHiddenMeeting } from "@/lib/hidden";
import { eventDateKey, extractBills } from "@/lib/match";
import {
  GET_HEARINGS_QUERY,
  PROFILE_QUERY,
  SA_GRAPHQL_URL,
  STATE_CONFIGS_QUERY,
} from "@/lib/sa-graphql";
import { loadSession, markSessionOk, saConfigured as sessionConfigured } from "@/lib/sa-session";
import { STATE_SOURCES } from "@/lib/states";

type SaRow = {
  entity_id?: string;
  meeting_id?: string | number;
  id?: string | number;
  title?: string;
  event_title?: string;
  event_date?: string;
  event_time?: string;
  event_description?: string;
  event_location?: string;
  location?: string;
  sa_url?: string;
  chamber?: string;
  state_id?: number;
  state?: { state_abbr?: string; state_name?: string };
  hidden?: boolean;
  is_hidden?: boolean;
  isHidden?: boolean;
  is_hidden_from_customer?: boolean;
  is_cancelled?: boolean;
};

type StateConfig = {
  state_id?: number;
  state_info?: { state_abbr?: string; state_name?: string };
};

type ListPayload = { data?: SaRow[]; total_count?: number; totalMeetingCount?: number };

type CapturedQuery = {
  operationName?: string;
  query?: string;
  variables?: Record<string, unknown>;
};

const MEETINGS_QUERY_FILE = path.join(process.cwd(), "data", "sa-meetings-query.json");
const MEETINGS_CAPTURE_FILE = path.join(process.cwd(), "data", "sa-meetings-captured.json");

function listPayload(data: Record<string, ListPayload | undefined> | undefined): ListPayload | undefined {
  if (!data) return undefined;
  const raw =
    data.meetingsSearchV2 ||
    data.getMeetingsList ||
    data.getHearingsList ||
    Object.values(data).find((value) => value && Array.isArray(value.data));
  if (!raw) return undefined;
  return { data: raw.data, total_count: raw.total_count || raw.totalMeetingCount || 0 };
}

function graphqlUrl(): string {
  return process.env.SA_GRAPHQL_URL?.trim() || SA_GRAPHQL_URL;
}

async function saHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: "https://admin.stateaffairs.com",
    referer: "https://admin.stateaffairs.com/meetings",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  };
  const session = await loadSession();
  if (session.cookie) headers.cookie = session.cookie;
  if (session.bearer) headers.authorization = `Bearer ${session.bearer}`;
  return headers;
}

export async function saConfigured(): Promise<boolean> {
  return sessionConfigured();
}

export function isSaBlocked(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /HTTP 403|HTTP 401|not signed in|Cloudflare/i.test(msg);
}

async function saQuery<T>(query: string, variables: Record<string, unknown>, operationName: string): Promise<T> {
  const res = await fetch(graphqlUrl(), {
    method: "POST",
    headers: await saHeaders(),
    cache: "no-store",
    body: JSON.stringify({ operationName, query, variables }),
  });
  const payload = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message?: string }[] };
  if (!res.ok) {
    throw new Error(`SA GraphQL HTTP ${res.status}`);
  }
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message).filter(Boolean).join("; ") || "SA GraphQL error");
  }
  if (!payload.data) throw new Error("SA GraphQL returned no data. Connect State Affairs in Settings.");
  return payload.data;
}

export type SaProfile = {
  email: string;
  name: string;
  active: boolean;
  primaryState: string;
};

export async function fetchSaProfile(): Promise<SaProfile> {
  const data = await saQuery<{
    profile?: {
      email?: string;
      name?: string;
      last_name?: string;
      is_active?: boolean;
      primary_state?: { state_abbr?: string; state_name?: string };
    } | null;
  }>(PROFILE_QUERY, {}, "Profile");
  const p = data.profile;
  if (!p?.email && !p?.name) {
    throw new Error("That State Affairs session is not signed in. Connect it again in Settings.");
  }
  const name = [p.name, p.last_name].filter(Boolean).join(" ").trim() || p.email || "";
  const profile = {
    email: p.email || "",
    name,
    active: p.is_active !== false,
    primaryState: p.primary_state?.state_abbr || p.primary_state?.state_name || "",
  };
  await markSessionOk({ email: profile.email, name: profile.name });
  return profile;
}

let configCache: { at: number; map: Map<string, number> } | null = null;

export async function saStateIdMap(): Promise<Map<string, number>> {
  const now = Date.now();
  if (configCache && now - configCache.at < 30 * 60 * 1000) return configCache.map;
  const data = await saQuery<{ stateConfigs: StateConfig[] }>(STATE_CONFIGS_QUERY, {}, "StateConfigs");
  const map = new Map<string, number>();
  for (const cfg of data.stateConfigs || []) {
    const abbr = (cfg.state_info?.state_abbr || "").trim().toUpperCase();
    const id = cfg.state_id;
    if (abbr && typeof id === "number") map.set(abbr, id);
  }
  for (const src of STATE_SOURCES) {
    if (!map.has(src.code)) {
      const hit = (data.stateConfigs || []).find(
        (c) => (c.state_info?.state_name || "").toLowerCase() === src.name.toLowerCase(),
      );
      if (hit?.state_id != null) map.set(src.code, hit.state_id);
    }
  }
  configCache = { at: now, map };
  return map;
}

function saEventDay(raw: string): string {
  const s = String(raw || "").trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!mdy) return "";
  const y = mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3];
  return `${y}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
}

export function toSaEvent(row: SaRow, state: string): CalendarEvent | null {
  if (row.is_cancelled || isHiddenMeeting(row)) return null;
  const id = String(row.entity_id || row.meeting_id || row.id || "").trim();
  const date = saEventDay(String(row.event_date || ""));
  if (!id || !date) return null;
  const time = String(row.event_time || "").trim();
  const start =
    time && /^\d{1,2}:\d{2}/.test(time) ? `${date}T${time.length === 5 ? `${time}:00` : time}` : `${date}T00:00:00`;
  const title = row.title || row.event_title || "Untitled meeting";
  return {
    sourceId: id,
    state,
    title,
    start,
    location: row.location || row.event_location || "",
    chamber: row.chamber || "",
    url: row.sa_url || "",
    bills: extractBills(`${title}\n${row.event_description || ""}`),
    description: row.event_description || "",
    raw: row,
  };
}

type ListPage = { events: CalendarEvent[]; total: number; days: string[]; n: number };

async function fetchListPage(
  stateCode: string,
  stateId: number,
  query: string,
  operationName: string,
  listKey: "getMeetingsList" | "getHearingsList",
  extra: Record<string, unknown> = {},
  page = 1,
  itemsPerPage = 50,
): Promise<ListPage> {
  const data = await saQuery<Record<string, ListPayload | undefined>>(
    query,
    { stateId, page, itemsPerPage, ...extra },
    operationName,
  );
  const rows = data[listKey]?.data || [];
  const events: CalendarEvent[] = [];
  const days: string[] = [];
  for (const row of rows) {
    days.push(saEventDay(String(row.event_date || "")));
    const ev = toSaEvent(row, stateCode);
    if (ev) events.push(ev);
  }
  return { events, total: data[listKey]?.total_count || 0, days, n: rows.length };
}

async function paginate(
  stateCode: string,
  stateId: number,
  query: string,
  operationName: string,
  listKey: "getMeetingsList" | "getHearingsList",
  extra: Record<string, unknown> = {},
  maxPages = 20,
  itemsPerPage = 50,
): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  const pages = Math.max(1, maxPages);
  for (let page = 1; page <= pages; page++) {
    const chunk = await fetchListPage(stateCode, stateId, query, operationName, listKey, extra, page, itemsPerPage);
    events.push(...chunk.events);
    if (!chunk.n || page * itemsPerPage >= chunk.total) break;
  }
  return events;
}

async function paginateNewestFrom(
  stateCode: string,
  stateId: number,
  query: string,
  operationName: string,
  listKey: "getMeetingsList" | "getHearingsList",
  extra: Record<string, unknown>,
  fromDay: string,
): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  const itemsPerPage = 100;
  const maxPages = 80;
  for (let page = 1; page <= maxPages; page++) {
    const chunk = await fetchListPage(
      stateCode,
      stateId,
      query,
      operationName,
      listKey,
      extra,
      page,
      itemsPerPage,
    );
    events.push(...chunk.events);
    if (!chunk.n) break;
    const dated = chunk.days.filter(Boolean);
    if (dated.length && dated.every((d) => d < fromDay)) break;
    if (page * itemsPerPage >= chunk.total) break;
  }
  return events;
}

let meetingsSupported: boolean | null = null;

function meetingsQueryUnsupported(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /HTTP 400|VALIDATION_ERROR|cannot query field|unknown field|getMeetingsList/i.test(msg);
}

function localIsoDay(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function fetchHearings(stateCode: string, stateId: number): Promise<CalendarEvent[]> {
  const events = await paginate(stateCode, stateId, GET_HEARINGS_QUERY, "GetHearingsList", "getHearingsList", {
    includeNeedsReviewBillHearings: false,
    onlyNeedsReviewBillHearings: false,
  });
  const have = new Set(events.map((e) => e.sourceId));
  for (let offset = 0; offset <= 14; offset += 1) {
    const dayEvents = await paginate(stateCode, stateId, GET_HEARINGS_QUERY, "GetHearingsList", "getHearingsList", {
      eventDate: localIsoDay(offset),
      includeNeedsReviewBillHearings: false,
      onlyNeedsReviewBillHearings: false,
    });
    for (const ev of dayEvents) {
      if (!have.has(ev.sourceId)) {
        have.add(ev.sourceId);
        events.push(ev);
      }
    }
  }
  return events;
}

let adminWindowCache: { at: number; from: string; to: string; byState: Map<string, CalendarEvent[]> } | null = null;

export function clearSaAdminWindowCache() {
  adminWindowCache = null;
}

async function loadSavedMeetingsQuery(): Promise<CapturedQuery | null> {
  try {
    const parsed = JSON.parse(await readFile(MEETINGS_QUERY_FILE, "utf8")) as CapturedQuery;
    if (!parsed.query || !/meetingsSearchV2|getMeetingsList|includeHidden/i.test(parsed.query)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function rowsToByState(
  rows: SaRow[],
  codeById: Map<number, string>,
  from: string,
  to: string,
): Map<string, CalendarEvent[]> {
  const byState = new Map<string, CalendarEvent[]>();
  const have = new Set<string>();
  for (const row of rows) {
    const code =
      (row.state?.state_abbr || "").trim().toUpperCase() ||
      (typeof row.state_id === "number" ? codeById.get(row.state_id) : undefined);
    if (!code) continue;
    const ev = toSaEvent(row, code);
    if (!ev) continue;
    const day = eventDateKey(ev.start) || saEventDay(ev.start);
    if (!day || day < from || day > to || have.has(ev.sourceId)) continue;
    have.add(ev.sourceId);
    const list = byState.get(code) || [];
    list.push(ev);
    byState.set(code, list);
  }
  return byState;
}

export async function importCapturedSaMeetings(
  fromDay?: string,
  toDay?: string,
): Promise<Map<string, CalendarEvent[]> | null> {
  try {
    const parsed = JSON.parse(await readFile(MEETINGS_CAPTURE_FILE, "utf8")) as {
      from?: string;
      to?: string;
      capturedAt?: string;
      rows?: SaRow[];
    };
    const window = upcomingWindow();
    const from = fromDay || parsed.from || window.from;
    const to = toDay || parsed.to || window.to;
    const at = Date.parse(parsed.capturedAt || "");
    if (!at || Date.now() - at > 6 * 60 * 60 * 1000) return null;
    const ids = await saStateIdMap();
    const codeById = new Map<number, string>();
    for (const [code, id] of ids) codeById.set(id, code);
    return rowsToByState(parsed.rows || [], codeById, from, to);
  } catch {
    return null;
  }
}

async function fetchSavedMeetingsWindow(
  from: string,
  to: string,
  codeById: Map<number, string>,
): Promise<Map<string, CalendarEvent[]> | null> {
  const saved = await loadSavedMeetingsQuery();
  if (!saved?.query) return null;
  const original = saved.variables || {};
  const itemsPerPage = Number(original.itemsPerPage) || 20;
  const operationName = saved.operationName || "MeetingsSearchV2";
  const zeroBased = /meetingsSearchV2/i.test(saved.query);
  const rows: SaRow[] = [];
  for (let i = 0; i < 80; i++) {
    const page = zeroBased ? i : i + 1;
    const variables: Record<string, unknown> = { ...original, page, itemsPerPage };
    if ("startDate" in original) variables.startDate = from;
    if ("endDate" in original) variables.endDate = to;
    if ("includeHidden" in original) variables.includeHidden = false;
    const data = await saQuery<Record<string, ListPayload | undefined>>(saved.query, variables, operationName);
    const listed = listPayload(data);
    const chunk = listed?.data || [];
    rows.push(...chunk);
    const total = listed?.total_count || 0;
    if (!chunk.length || (i + 1) * itemsPerPage >= total) break;
  }
  return rowsToByState(rows, codeById, from, to);
}

export async function fetchSaAdminWindow(fromDay?: string, toDay?: string): Promise<Map<string, CalendarEvent[]>> {
  const window = upcomingWindow();
  const from = fromDay || window.from;
  const to = toDay || window.to;
  if (
    adminWindowCache &&
    adminWindowCache.from === from &&
    adminWindowCache.to === to &&
    Date.now() - adminWindowCache.at < 5 * 60 * 1000
  ) {
    return adminWindowCache.byState;
  }

  const ids = await saStateIdMap();
  const codeById = new Map<number, string>();
  for (const [code, id] of ids) codeById.set(id, code);

  try {
    const fromQuery = await fetchSavedMeetingsWindow(from, to, codeById);
    if (fromQuery && [...fromQuery.values()].some((list) => list.length)) {
      adminWindowCache = { at: Date.now(), from, to, byState: fromQuery };
      return fromQuery;
    }
  } catch {
    /* saved meetings query is optional */
  }

  const captured = await importCapturedSaMeetings(from, to);
  if (captured && [...captured.values()].some((list) => list.length)) {
    adminWindowCache = { at: Date.now(), from, to, byState: captured };
    return captured;
  }

  const byState = new Map<string, CalendarEvent[]>();
  const have = new Set<string>();
  const extra = {
    includeNeedsReviewBillHearings: false,
    onlyNeedsReviewBillHearings: false,
  };
  const itemsPerPage = 100;
  let stalePages = 0;

  for (let page = 1; page <= 80; page++) {
    const data = await saQuery<Record<string, ListPayload | undefined>>(
      GET_HEARINGS_QUERY,
      { page, itemsPerPage, ...extra },
      "GetHearingsList",
    );
    const rows = data.getHearingsList?.data || [];
    if (!rows.length) break;
    const days = rows.map((row) => saEventDay(String(row.event_date || ""))).filter(Boolean);
    let inWindow = 0;
    for (const row of rows) {
      const code = typeof row.state_id === "number" ? codeById.get(row.state_id) : undefined;
      if (!code) continue;
      const ev = toSaEvent(row, code);
      if (!ev) continue;
      const day = eventDateKey(ev.start) || saEventDay(ev.start);
      if (!day || day < from || day > to || have.has(ev.sourceId)) continue;
      have.add(ev.sourceId);
      inWindow += 1;
      const list = byState.get(code) || [];
      list.push(ev);
      byState.set(code, list);
    }
    if (days.length && days.every((d) => d < from)) {
      stalePages += 1;
      if (stalePages >= 2) break;
    } else {
      stalePages = 0;
    }
    const total = data.getHearingsList?.total_count || 0;
    if (page * itemsPerPage >= total) break;
    if (!inWindow && days.length && days[days.length - 1] < from && page > 1) break;
  }

  adminWindowCache = { at: Date.now(), from, to, byState };
  return byState;
}

export async function fetchSaUpcoming(
  stateCode: string,
  _stateId?: number,
  fromDay?: string,
  toDay?: string,
): Promise<CalendarEvent[]> {
  const window = upcomingWindow();
  const byState = await fetchSaAdminWindow(fromDay || window.from, toDay || window.to);
  return byState.get(stateCode) || [];
}

export async function fetchSaMeetings(stateCode: string, stateId: number): Promise<CalendarEvent[]> {
  return fetchSaUpcoming(stateCode, stateId);
}

export async function fetchSaHearings(stateCode: string, stateId: number): Promise<CalendarEvent[]> {
  return fetchSaMeetings(stateCode, stateId);
}

export function ingestRowsToEvents(state: string, rows: Array<Record<string, unknown>>): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const row of rows) {
    if (isHiddenMeeting(row)) continue;
    if (row.sourceId && row.start && row.title) {
      out.push({
        sourceId: String(row.sourceId),
        state: String(row.state || state).toUpperCase(),
        title: String(row.title),
        start: String(row.start),
        location: String(row.location || ""),
        chamber: String(row.chamber || ""),
        url: String(row.url || ""),
        bills: Array.isArray(row.bills) ? row.bills.map(String) : extractBills(String(row.title)),
      });
      continue;
    }
    const ev = toSaEvent(
      {
        entity_id: String(row.entity_id || row.meeting_id || row.id || ""),
        title: String(row.title || row.event_title || ""),
        event_date: String(row.event_date || row.date || ""),
        event_time: String(row.event_time || row.time || ""),
        location: String(row.location || row.event_location || ""),
        sa_url: String(row.sa_url || row.url || ""),
        chamber: String(row.chamber || ""),
        is_hidden_from_customer: Boolean(row.is_hidden_from_customer),
        is_cancelled: Boolean(row.is_cancelled),
      },
      state,
    );
    if (ev) out.push(ev);
  }
  return out;
}
