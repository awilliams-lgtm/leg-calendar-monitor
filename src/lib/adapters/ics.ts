import type { CalendarEvent } from "@/lib/types";
import { officialSourceRaw } from "@/lib/event-raw";
import { extractBills } from "@/lib/match";
import { fetchText } from "@/lib/html";

function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

function icsTimeToIso(value: string): string {
  const v = value.trim();
  if (/^\d{8}$/.test(v)) {
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T00:00:00`;
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return v;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  return m[7] ? `${iso}Z` : iso;
}

function unescape(text: string): string {
  return text.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

export function parseIcsText(ics: string): CalendarEvent[] {
  const text = unfold(ics);
  const blocks = text.split(/BEGIN:VEVENT/i).slice(1);
  const events: CalendarEvent[] = [];

  for (const block of blocks) {
    const body = block.split(/END:VEVENT/i)[0] || "";
    const field = (name: string) => {
      const re = new RegExp(`^${name}[^:]*:(.*)$`, "im");
      const m = body.match(re);
      return m ? unescape(m[1].trim()) : "";
    };
    const uid = field("UID") || field("SUMMARY") + field("DTSTART");
    const start = icsTimeToIso(field("DTSTART"));
    const title = (field("SUMMARY") || "Untitled event").replace(/\s+/g, " ").trim();
    if (!uid || !start) continue;
    const event = {
      sourceId: uid.slice(0, 180),
      state: "",
      title,
      start,
      end: field("DTEND") ? icsTimeToIso(field("DTEND")) : "",
      location: field("LOCATION"),
      url: field("URL"),
      bills: extractBills(`${title}\n${field("DESCRIPTION")}`),
      description: field("DESCRIPTION"),
    };
    events.push({ ...event, raw: officialSourceRaw(event) });
  }
  return events;
}

export async function fetchIcsEvents(icsUrl: string): Promise<CalendarEvent[]> {
  return parseIcsText(await fetchText(icsUrl));
}
