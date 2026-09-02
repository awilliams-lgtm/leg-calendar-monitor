import type { CalendarEvent } from "@/lib/types";
import { envVar } from "@/lib/env";
import { extractBills } from "@/lib/match";

type OpenStatesEvent = {
  id?: string;
  name?: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  all_day?: boolean;
  status?: string;
  classification?: string;
  location?: { name?: string } | string;
  links?: { url?: string }[];
  sources?: { url?: string }[];
  agenda?: { description?: string; related_entities?: { name?: string; entity_type?: string }[] }[];
};

function locationName(loc: OpenStatesEvent["location"]): string {
  if (!loc) return "";
  if (typeof loc === "string") return loc;
  return loc.name || "";
}

let lastOpenStatesAt = 0;

async function openStatesGet(url: URL, key: string): Promise<Response> {
  const wait = 7000 - (Date.now() - lastOpenStatesAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastOpenStatesAt = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      headers: { "X-API-KEY": key, Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 429 && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 20000));
      lastOpenStatesAt = Date.now();
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Open States ${res.status}: ${body.slice(0, 240)}`);
    }
    return res;
  }
  throw new Error("Open States 429: rate limit");
}

export async function fetchOpenStatesEvents(jurisdiction: string, afterIso: string): Promise<CalendarEvent[]> {
  const key = envVar("OPENSTATES_API_KEY");
  if (!key) {
    throw new Error("OPENSTATES_API_KEY is not set");
  }

  const events: CalendarEvent[] = [];
  let page = 1;
  const perPage = 20;

  while (page <= 8) {
    const url = new URL("https://v3.openstates.org/events");
    url.searchParams.set("jurisdiction", jurisdiction);
    url.searchParams.set("after", afterIso);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    url.searchParams.append("include", "agenda");

    const res = await openStatesGet(url, key);
    const payload = (await res.json()) as { results?: OpenStatesEvent[]; pagination?: { max_page?: number } };
    const rows = payload.results || [];
    for (const row of rows) {
      if (!row.id || !row.start_date) continue;
      const blob = [row.name, row.description, ...(row.agenda || []).map((a) => a.description)]
        .filter(Boolean)
        .join("\n");
      const billFromAgenda =
        row.agenda?.flatMap((a) =>
          (a.related_entities || [])
            .filter((e) => (e.entity_type || "").toLowerCase().includes("bill"))
            .map((e) => e.name || ""),
        ) || [];
      events.push({
        sourceId: row.id,
        state: "",
        title: row.name || "Untitled event",
        start: row.start_date,
        end: row.end_date,
        allDay: Boolean(row.all_day),
        location: locationName(row.location),
        url: row.links?.[0]?.url || row.sources?.[0]?.url || "",
        bills: [...new Set([...extractBills(blob), ...billFromAgenda.filter(Boolean)])],
        description: row.description || "",
        raw: row,
      });
    }
    const maxPage = payload.pagination?.max_page || page;
    if (page >= maxPage || rows.length < perPage) break;
    page += 1;
  }

  return events;
}
