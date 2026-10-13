import type { CalendarEvent } from "@/lib/types";

const EMPTY = new Set(["", "{}", "[]", "null", '""']);
const MAX_RAW_CHARS = 64_000;

export function isEmptyRaw(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return EMPTY.has(value.trim());
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

export function serializeEventRaw(value: unknown): string {
  if (typeof value === "string") {
    const text = isEmptyRaw(value) ? "" : value;
    return text.length > MAX_RAW_CHARS ? text.slice(0, MAX_RAW_CHARS) : text;
  }
  if (isEmptyRaw(value)) return "";
  try {
    const encoded = JSON.stringify(value);
    if (isEmptyRaw(encoded)) return "";
    return encoded.length > MAX_RAW_CHARS ? encoded.slice(0, MAX_RAW_CHARS) : encoded;
  } catch {
    return "";
  }
}

export function parseEventRaw(value: unknown): unknown {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") return isEmptyRaw(value) ? undefined : value;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isEmptyRaw(parsed) ? undefined : parsed;
  } catch {
    return value;
  }
}

function isSourceDocument(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  return Boolean(
    o.record ||
      o.vevent ||
      o.html ||
      o.agenda ||
      o.start_date ||
      o.EventId ||
      o.hearingID ||
      o.HearingID ||
      o.scheduledDateTime ||
      (typeof o.id === "string" && o.id.startsWith("ocd-event/")),
  );
}

/**
 * Persist the source's own record so SuperDupa / re-parse can recover it.
 * API, Open States, and ICS parsers pass that object as `ev.raw`.
 * HTML listings get a snapshot keyed by the official page URL — never `{}`.
 */
export function officialSourceRaw(ev: Partial<CalendarEvent> & { bills?: string[] }): unknown {
  const provided = ev.raw;
  if (!isEmptyRaw(provided) && isSourceDocument(provided)) return provided;
  if (!isEmptyRaw(provided) && typeof provided === "object") {
    return {
      url: ev.url || "",
      sourceId: ev.sourceId || "",
      record: provided,
    };
  }
  return {
    url: ev.url || "",
    sourceId: ev.sourceId || "",
    title: ev.title || "",
    start: ev.start || "",
    end: ev.end || "",
    location: ev.location || "",
    chamber: ev.chamber || "",
    description: ev.description || "",
    bills: ev.bills || [],
  };
}

export function pickRicherRaw(incoming: unknown, existing: unknown): unknown {
  if (isEmptyRaw(incoming)) return existing;
  if (isEmptyRaw(existing)) return incoming;
  const next = serializeEventRaw(incoming);
  const prev = serializeEventRaw(existing);
  return next.length >= prev.length ? incoming : existing;
}
