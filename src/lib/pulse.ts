import { envVar } from "@/lib/env";

/**
 * Run log for supa-dupa's Collector Pulse. One `fetch.attempted` event per state per sync goes to
 * POST {SUPA_DUPA_URL}/api/collector/events, so supa-dupa can tell "checked, nothing new" from "failed".
 *
 * Needs SUPA_DUPA_COLLECTOR_KEY: issue it in supa-dupa under Settings -> Collectors, with the collector
 * named `leg_calendar_monitor`. Without the key nothing is sent. Reporting never fails a sync.
 */

export type PulseOutcome = "succeeded" | "source_empty" | "failed";

export type PulseEvent = {
  event_type: "fetch.attempted";
  occurred_at: string;
  event_key: string;
  outcome: PulseOutcome;
  source: string;
  partition: string;
  kind: "legislative_meeting";
  items_extracted: number;
  rows_written: number;
  duration_ms: number;
  error: string | null;
  run_id: string;
  code_version: string | null;
};

const DEFAULT_URL = "https://supa-d00pa.vercel.app";
const TIMEOUT_MS = 5000;

/** What one state's official sync amounted to, in supa-dupa's outcome vocabulary. */
export function syncOutcome(r: { threw: boolean; keptLastGood: boolean; found: number; failedNotes: number }): PulseOutcome {
  if (r.threw || r.keptLastGood) return "failed";
  if (r.found > 0) return "succeeded";
  return r.failedNotes > 0 ? "failed" : "source_empty";
}

export function pulseEvent(args: {
  state: string;
  startedAt: Date;
  finishedAt: Date;
  outcome: PulseOutcome;
  found: number;
  written: number;
  error?: string | null;
  codeVersion?: string | null;
}): PulseEvent {
  const state = args.state.toUpperCase();
  const started = args.startedAt.toISOString();
  const runId = `${state}-${started}`;
  return {
    event_type: "fetch.attempted",
    occurred_at: args.finishedAt.toISOString(),
    event_key: `official:${runId}`,
    outcome: args.outcome,
    source: state,
    partition: state,
    kind: "legislative_meeting",
    items_extracted: args.found,
    rows_written: args.written,
    duration_ms: Math.max(0, args.finishedAt.getTime() - args.startedAt.getTime()),
    error: args.error ? args.error.slice(0, 2000) : null,
    run_id: runId,
    code_version: args.codeVersion ?? null,
  };
}

/** Post events to supa-dupa. Best effort: returns false instead of throwing. */
export async function postPulse(events: PulseEvent[], fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const key = envVar("SUPA_DUPA_COLLECTOR_KEY");
  if (!key || events.length === 0) return false;
  const base = (envVar("SUPA_DUPA_URL") || DEFAULT_URL).replace(/\/+$/, "");
  try {
    const res = await fetchImpl(`${base}/api/collector/events`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) console.warn(`supa-dupa pulse: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
    return res.ok;
  } catch (err) {
    console.warn(`supa-dupa pulse: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export const codeVersion = () => envVar("VERCEL_GIT_COMMIT_SHA").slice(0, 12) || null;
