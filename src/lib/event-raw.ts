import type { CalendarEvent } from "@/lib/types";

const EMPTY = new Set(["", "{}", "[]", "null", '""']);

export function isEmptyRaw(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return EMPTY.has(value.trim());
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

export function serializeEventRaw(value: unknown): string {
  if (typeof value === "string") return isEmptyRaw(value) ? "" : value;
  if (isEmptyRaw(value)) return "";
  try {
    const encoded = JSON.stringify(value);
    return isEmptyRaw(encoded) ? "" : encoded;
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

export function officialSourceRaw(ev: Partial<CalendarEvent> & { bills?: string[] }): unknown {
  if (!isEmptyRaw(ev.raw)) return ev.raw;
  return {
    sourceId: ev.sourceId || "",
    title: ev.title || "",
    start: ev.start || "",
    end: ev.end || "",
    location: ev.location || "",
    chamber: ev.chamber || "",
    url: ev.url || "",
    description: ev.description || "",
    bills: ev.bills || [],
  };
}
