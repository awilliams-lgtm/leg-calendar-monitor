import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import type { CalendarEvent } from "@/lib/types";
import { envVar } from "@/lib/env";
import { decodeEntities } from "@/lib/html";
import { isHiddenMeeting } from "@/lib/hidden";
import { extractBills, sanitizeBills } from "@/lib/match";
import { inferChamber, stateByCode } from "@/lib/states";

/** Warehouse `state_affairs_prod.state` ids. The reader key cannot SELECT that table. */
export const SA_STATE_BY_ID: Record<number, string> = {
  0: "EP",
  1: "AL",
  2: "AK",
  3: "AZ",
  4: "AR",
  5: "CA",
  6: "CO",
  7: "CT",
  8: "DE",
  9: "FL",
  10: "GA",
  11: "HI",
  12: "ID",
  13: "IL",
  14: "IN",
  15: "IA",
  16: "KS",
  17: "KY",
  18: "LA",
  19: "ME",
  20: "MD",
  21: "MA",
  22: "MI",
  23: "MN",
  24: "MS",
  25: "MO",
  26: "MT",
  27: "NE",
  28: "NV",
  29: "NH",
  30: "NJ",
  31: "NM",
  32: "NY",
  33: "NC",
  34: "ND",
  35: "OH",
  36: "OK",
  37: "OR",
  38: "PA",
  39: "RI",
  40: "SC",
  41: "SD",
  42: "TN",
  43: "TX",
  44: "UT",
  45: "VT",
  46: "VA",
  47: "WA",
  48: "WV",
  49: "WI",
  50: "WY",
  51: "DC",
  52: "US",
};

type ServiceAccount = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
  token_uri?: string;
};

type BqField = { name: string };
type BqRow = { f?: Array<{ v?: string | null }> };
type BqQueryResponse = {
  kind?: string;
  jobComplete?: boolean;
  jobReference?: { projectId?: string; jobId?: string; location?: string };
  schema?: { fields?: BqField[] };
  rows?: BqRow[];
  pageToken?: string;
  totalRows?: string;
  error?: { message?: string };
  errors?: Array<{ message?: string }>;
};

type BqMeetingRow = {
  meeting_id?: string | null;
  state_id?: string | null;
  event_title?: string | null;
  event_date?: string | null;
  event_location?: string | null;
  event_description?: string | null;
  sc_type?: string | null;
  sc_document_url?: string | null;
  is_cancelled?: string | null;
  is_hidden_from_customer?: string | null;
  origin_type?: string | null;
  hearing_id?: string | null;
  _ab_cdc_deleted_at?: string | null;
};

let tokenCache: { token: string; exp: number } | null = null;

function credentialsJson(): string {
  const raw = envVar("SA_BQ_CREDENTIALS");
  if (raw) return raw;
  const b64 = envVar("SA_BQ_CREDENTIALS_BASE64");
  if (b64) return Buffer.from(b64, "base64").toString("utf8");
  const file = envVar("GOOGLE_APPLICATION_CREDENTIALS");
  if (!file) return "";
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export function bqConfigured(): boolean {
  const raw = credentialsJson();
  if (!raw) return false;
  try {
    const creds = JSON.parse(raw) as ServiceAccount;
    return Boolean(creds.client_email && creds.private_key);
  } catch {
    return false;
  }
}

function loadCredentials(): ServiceAccount {
  const raw = credentialsJson();
  if (!raw) throw new Error("Set SA_BQ_CREDENTIALS to the BigQuery reader JSON.");
  const creds = JSON.parse(raw) as ServiceAccount;
  if (!creds.client_email || !creds.private_key) {
    throw new Error("SA_BQ_CREDENTIALS is missing client_email or private_key.");
  }
  creds.private_key = creds.private_key.replace(/\\n/g, "\n");
  creds.token_uri = creds.token_uri || "https://oauth2.googleapis.com/token";
  return creds;
}

function b64url(value: object | string): string {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

function ident(raw: string, fallback: string): string {
  const v = (raw || "").trim() || fallback;
  if (!/^[A-Za-z0-9_-]+$/.test(v)) throw new Error("Invalid BigQuery identifier");
  return v;
}

function dayLit(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid date window");
  return value;
}

async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 60 > now) return tokenCache.token;
  const creds = loadCredentials();
  const header = b64url({ alg: "RS256", typ: "JWT" });
  const payload = b64url({
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/bigquery.readonly",
    aud: creds.token_uri,
    iat: now,
    exp: now + 3600,
  });
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const jwt = `${header}.${payload}.${sign.sign(creds.private_key!, "base64url")}`;
  const res = await fetch(creds.token_uri!, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  const body = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!body.access_token) {
    throw new Error(`BigQuery auth failed (${res.status}). Check the reader key.`);
  }
  tokenCache = { token: body.access_token, exp: now + Math.max(60, Number(body.expires_in) || 3600) };
  return body.access_token;
}

function rowObjects(payload: BqQueryResponse): Record<string, string | null>[] {
  const cols = (payload.schema?.fields || []).map((field) => field.name);
  return (payload.rows || []).map((row) => {
    const out: Record<string, string | null> = {};
    cols.forEach((name, i) => {
      out[name] = row.f?.[i]?.v ?? null;
    });
    return out;
  });
}

function bqError(payload: BqQueryResponse, status: number): string {
  return (
    payload.error?.message ||
    payload.errors?.map((err) => err.message).filter(Boolean).join("; ") ||
    `BigQuery HTTP ${status}`
  );
}

async function runQuery(sql: string): Promise<Record<string, string | null>[]> {
  const creds = loadCredentials();
  const project = ident(envVar("SA_BQ_PROJECT") || creds.project_id || "", "pendo-test-456821");
  const token = await accessToken();
  const started = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      query: sql,
      useLegacySql: false,
      timeoutMs: 60000,
      maxResults: 5000,
      location: envVar("SA_BQ_LOCATION") || "US",
    }),
  });
  let payload = (await started.json()) as BqQueryResponse;
  if (!started.ok || payload.error) throw new Error(bqError(payload, started.status));

  const jobId = payload.jobReference?.jobId;
  const location = payload.jobReference?.location || envVar("SA_BQ_LOCATION") || "US";
  const rows: Record<string, string | null>[] = [];

  for (let page = 0; page < 20; page += 1) {
    if (!payload.jobComplete) {
      if (!jobId) throw new Error("BigQuery job did not complete.");
      await new Promise((resolve) => setTimeout(resolve, 400));
      const pending = await fetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries/${encodeURIComponent(jobId)}?location=${encodeURIComponent(location)}&maxResults=5000`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      payload = (await pending.json()) as BqQueryResponse;
      if (!pending.ok || payload.error) throw new Error(bqError(payload, pending.status));
      continue;
    }
    rows.push(...rowObjects(payload));
    if (!payload.pageToken || !jobId) break;
    const next = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries/${encodeURIComponent(jobId)}?location=${encodeURIComponent(location)}&maxResults=5000&pageToken=${encodeURIComponent(payload.pageToken)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    payload = (await next.json()) as BqQueryResponse;
    if (!next.ok || payload.error) throw new Error(bqError(payload, next.status));
  }
  return rows;
}

export function bqBool(value: unknown): boolean {
  if (value === true || value === 1) return true;
  const t = String(value ?? "").trim().toLowerCase();
  return t === "true" || t === "1" || t === "yes";
}

export function bqDateTime(raw: string): string {
  const s = String(raw || "").trim().replace(" ", "T");
  const full = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  if (full) return `${full[1]}T${full[2]}`;
  const day = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return day ? `${day[1]}T00:00:00` : "";
}

export function stateCodeForId(stateId: number): string {
  const code = SA_STATE_BY_ID[stateId];
  if (!code || !stateByCode(code)) return "";
  return code;
}

export function mapBqMeeting(row: BqMeetingRow): CalendarEvent | null {
  if (bqBool(row.is_cancelled) || row._ab_cdc_deleted_at) return null;
  const id = String(row.meeting_id || "").trim();
  const start = bqDateTime(String(row.event_date || ""));
  const state = stateCodeForId(Number(row.state_id));
  const title = decodeEntities(String(row.event_title || "")).replace(/\s+/g, " ").trim();
  if (!id || !start || !state || !title) return null;
  const description = decodeEntities(String(row.event_description || "")).trim();
  const location = decodeEntities(String(row.event_location || "")).replace(/\s+/g, " ").trim();
  const doc = String(row.sc_document_url || "").trim();
  const mapped: CalendarEvent = {
    sourceId: id,
    state,
    title,
    start,
    location,
    chamber: inferChamber("", title),
    url: doc,
    bills: sanitizeBills(extractBills(`${title}\n${description}`)),
    description,
    raw: row,
  };
  if (doc) mapped.attachments = [{ label: "Document", url: doc }];
  if (isHiddenMeeting(mapped)) return null;
  return mapped;
}

export async function fetchSaFromBigQuery(
  from: string,
  to: string,
  onlyStates?: string[],
): Promise<Map<string, CalendarEvent[]>> {
  const creds = loadCredentials();
  const project = ident(envVar("SA_BQ_PROJECT") || creds.project_id || "", "pendo-test-456821");
  const dataset = ident(envVar("SA_BQ_DATASET"), "state_affairs_prod");
  const table = ident(envVar("SA_BQ_TABLE"), "meeting");
  const sql = `SELECT
  meeting_id,
  state_id,
  event_title,
  CAST(event_date AS STRING) AS event_date,
  event_location,
  event_description,
  sc_type,
  sc_document_url,
  is_cancelled,
  is_hidden_from_customer,
  origin_type,
  hearing_id,
  CAST(_ab_cdc_deleted_at AS STRING) AS _ab_cdc_deleted_at
FROM \`${project}.${dataset}.${table}\`
WHERE event_date >= DATETIME('${dayLit(from)}')
  AND event_date < DATETIME('${dayLit(to)}') + INTERVAL 1 DAY
  AND IFNULL(is_cancelled, FALSE) = FALSE`;

  const wanted = onlyStates?.length ? new Set(onlyStates.map((code) => code.toUpperCase())) : null;
  const byState = new Map<string, CalendarEvent[]>();
  const have = new Set<string>();
  for (const raw of await runQuery(sql)) {
    const ev = mapBqMeeting(raw);
    if (!ev || (wanted && !wanted.has(ev.state)) || have.has(ev.sourceId)) continue;
    have.add(ev.sourceId);
    const list = byState.get(ev.state) || [];
    list.push(ev);
    byState.set(ev.state, list);
  }
  return byState;
}
