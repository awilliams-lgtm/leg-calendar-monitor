import { fetchIcsEvents } from "@/lib/adapters/ics";
import { fetchOfficialApis, parseExtraByState } from "@/lib/adapters/official-extra";
import { extractBills } from "@/lib/match";
import {
  absUrl,
  decodeEntities,
  fetchJson,
  fetchText,
  mapPool,
  parseHumanDate,
  stripTags,
  toIso,
} from "@/lib/html";
import type { StateSource } from "@/lib/states";
import { upcomingWindow } from "@/lib/dates";
import { isHiddenMeeting } from "@/lib/hidden";
import { officialSourceRaw } from "@/lib/event-raw";
import { cleanOfficialTitle, junkOfficialTitle, withChamberLabel } from "@/lib/title";
import type { CalendarEvent } from "@/lib/types";

function ev(partial: Omit<CalendarEvent, "bills" | "state"> & { state: string; bills?: string[] }): CalendarEvent {
  const title = cleanOfficialTitle(partial.title);
  const bills = partial.bills?.length ? partial.bills : extractBills(`${title}\n${partial.description || ""}`);
  const next = { ...partial, title, bills };
  return { ...next, raw: officialSourceRaw(next) };
}

function hashId(state: string, start: string, title: string): string {
  const key = `${state}|${start}|${title}`.toLowerCase().replace(/\s+/g, " ").slice(0, 180);
  return key;
}

function applyChamber(events: CalendarEvent[], chamber: string): CalendarEvent[] {
  return events.map((e) => ({ ...e, chamber: e.chamber || chamber }));
}

export async function fetchOfficialEvents(src: StateSource): Promise<{ events: CalendarEvent[]; notes: string[] }> {
  const notes: string[] = [];
  const collected: CalendarEvent[] = [];

  if (src.code === "MA") {
    try {
      const api = await fetchMaHearingsApi();
      collected.push(...api);
      notes.push(`MA api → ${api.length}`);
    } catch (err) {
      notes.push(`MA api failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      const sessions = await fetchMaSessionsApi();
      collected.push(...sessions);
      notes.push(`MA sessions → ${sessions.length}`);
    } catch (err) {
      notes.push(`MA sessions failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const extraApis = await fetchOfficialApis(src);
  collected.push(...extraApis.events);
  notes.push(...extraApis.notes);

  const skipHtml =
    src.code === "SD" ||
    (src.code === "GA" && collected.length > 0) ||
    src.code === "IN" ||
    src.code === "NV" ||
    src.code === "KS" ||
    (src.code === "MI" && collected.length > 0) ||
    src.code === "RI" ||
    src.code === "WV" ||
    src.code === "IL" ||
    src.code === "ID" ||
    src.code === "US" ||
    src.code === "VA" ||
    src.code === "WI" ||
    src.code === "MO" ||
    (["OR", "HI", "OH", "CO", "FL", "VT", "NM", "AK", "MS", "AR", "NH", "NY", "AZ", "OK", "UT", "CT", "ME", "LA", "SC", "NE", "MT", "DE", "TN", "PA"].includes(src.code) &&
      collected.length > 0) ||
    (src.code === "MA" && collected.length > 0) ||
    (["WA", "ND", "NJ", "AL", "WY"].includes(src.code) && collected.length > 0);
  const feeds = skipHtml
    ? []
    : src.feeds.length
      ? src.feeds
      : [{ chamber: "joint" as const, label: "Calendar", url: src.officialUrl }];

  for (const feed of feeds) {
    const url = feed.url;
    try {
      const html = await fetchText(url);
      const parsed = applyChamber(parseByState(src.code, html, url), feed.chamber);
      collected.push(...parsed);
      const skipGeneric = parsed.length > 0 || src.code === "CA";
      const generic = skipGeneric ? [] : applyChamber(parseGeneric(html, url, src.code), feed.chamber);
      collected.push(...generic);
      notes.push(`${src.code} ${feed.label} → parse ${parsed.length} generic ${generic.length}`);
      const ics =
        src.code === "CA" && parsed.length > 0
          ? []
          : applyChamber(await extractIcsFromHtml(html, url, src.code), feed.chamber);
      if (ics.length) {
        collected.push(...ics);
        notes.push(`${src.code} ${feed.label} ics → ${ics.length}`);
      }
    } catch (err) {
      notes.push(`${src.code} ${feed.label} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const seen = new Set<string>();
  const events = collected.filter((e) => {
    const id = e.sourceId || hashId(e.state, e.start, e.title);
    if (seen.has(id)) return false;
    seen.add(id);
    e.sourceId = id;
    return Boolean(e.title && e.start) && !junkOfficialTitle(e.title) && !isHiddenMeeting(e);
  });
  return { events, notes };
}

function parseByState(code: string, html: string, pageUrl: string): CalendarEvent[] {
  switch (code) {
    case "MA":
      return parseMa(html);
    case "IA":
      return parseIa(html, pageUrl);
    case "NC":
      return parseNc(html, pageUrl);
    case "MD":
      return parseGoogleCalendarTemplates(html, "MD", pageUrl);
    case "CA":
      return parseCa(html, pageUrl);
    case "ID":
      return parseJsonLd(html, "ID", pageUrl);
    case "KY":
    case "MN":
    case "TX":
    case "IL":
      return parseExtraByState(code, html, pageUrl);
    case "PA":
      return [...parseExtraByState("PA", html, pageUrl), ...parseGoogleCalendarTemplates(html, "PA", pageUrl)];
    case "AR":
      return parseExtraByState(code, html, pageUrl);
    case "NJ":
      return parseExtraByState(code, html, pageUrl);
    case "NV":
    case "OR":
    case "CO":
    case "MO":
    case "FL":
    case "NM":
    case "AK":
    case "MS":
    case "NY":
    case "RI":
    case "WV":
    case "UT":
    case "VT":
    case "CT":
    case "ME":
    case "LA":
    case "SC":
    case "NE":
    case "MT":
    case "DE":
    case "TN":
      return parseExtraByState(code, html, pageUrl);
    default:
      return [];
  }
}

export function parseOfficialPage(code: string, html: string, pageUrl: string): CalendarEvent[] {
  const parsed = parseByState(code, html, pageUrl);
  const skipGeneric = parsed.length > 0 || code === "CA";
  const generic = skipGeneric ? [] : parseGeneric(html, pageUrl, code);
  const seen = new Set<string>();
  return [...parsed, ...generic].filter((e) => {
    const id = e.sourceId || hashId(e.state, e.start, e.title);
    if (seen.has(id)) return false;
    seen.add(id);
    e.sourceId = id;
    return Boolean(e.title && e.start) && !junkOfficialTitle(e.title) && !isHiddenMeeting(e);
  });
}

function parseCa(html: string, pageUrl: string): CalendarEvent[] {
  if (/assembly\.ca\.gov/i.test(pageUrl)) return parseCaAssembly(html, pageUrl);
  if (/senate\.ca\.gov/i.test(pageUrl)) return parseCaSenate(html, pageUrl);
  return [...parseCaAssembly(html, pageUrl), ...parseCaSenate(html, pageUrl)];
}

function tdClass(row: string, cls: string): string {
  const m = row.match(new RegExp(`<(?:td|th)[^>]*${cls}[^>]*>([\\s\\S]*?)</(?:td|th)>`, "i"));
  return m ? stripTags(m[1]) : "";
}

function parseCaAssembly(html: string, pageUrl: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const rowRe = /<tr[^>]*committee-hearing-details[\s\S]*?<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html))) {
    const date = tdClass(row[0], "committee_hearing-date");
    const timeRaw = tdClass(row[0], "committee_hearing-time");
    const name = tdClass(row[0], "committee_hearing-name");
    const location = tdClass(row[0], "committee_hearing-location");
    const parsed = parseHumanDate(date);
    const title = withChamberLabel(cleanOfficialTitle(name), "Assembly");
    if (!parsed || junkOfficialTitle(title)) continue;
    const clock = timeRaw.match(/\d{1,2}:\d{2}\s*[ap]\.?m\.?/i)?.[0];
    const href =
      row[0].match(/href="([^"]*agenda[^"]*)"/i)?.[1] ||
      row[0].match(/href="([^"]*ics\/generate[^"]*)"/i)?.[1];
    events.push(
      ev({
        sourceId: hashId("CA", toIso(parsed.y, parsed.m, parsed.d, clock), title),
        state: "CA",
        title,
        start: toIso(parsed.y, parsed.m, parsed.d, clock),
        location,
        chamber: "house",
        url: href ? absUrl(pageUrl, href) : pageUrl,
      }),
    );
  }
  return events;
}

function parseCaSenate(html: string, pageUrl: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  let currentDate: { y: number; m: number; d: number } | null = null;
  const re =
    /<h2[^>]*page-events__date[^>]*>([\s\S]*?)<\/h2>|<h4[^>]*page-events__title[^>]*>([\s\S]*?)<\/h4>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1]) {
      currentDate = parseHumanDate(stripTags(m[1]));
      continue;
    }
    if (!currentDate) continue;
    const rawTitle = stripTags(m[2]);
    const before = html.slice(Math.max(0, m.index - 500), m.index);
    if (!/page-events__item--(floor-meeting|committee-hearing)/.test(before)) continue;
    const isFloor = /page-events__item--floor-meeting/.test(before);
    const ahead = html.slice(m.index, m.index + 1400);
    const timeLoc = stripTags(
      ahead.match(/page-events__time-location[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "",
    ).replace(/^Time:\s*/i, "");
    const clock = timeLoc.match(/\d{1,2}:\d{2}\s*[ap]\.?m\.?/i)?.[0];
    const location = timeLoc
      .replace(/\d{1,2}:\d{2}\s*[ap]\.?m\.?/gi, "")
      .replace(/upon call of the chair/gi, "")
      .replace(/^[\s\-–—]+/, "")
      .trim();
    const title = withChamberLabel(
      cleanOfficialTitle(isFloor ? "Floor Session" : rawTitle),
      "Senate",
    );
    if (junkOfficialTitle(title)) continue;
    const agenda = ahead.match(/href="([^"]*agenda[^"]*)"/i)?.[1];
    events.push(
      ev({
        sourceId: hashId("CA", toIso(currentDate.y, currentDate.m, currentDate.d, clock), title),
        state: "CA",
        title,
        start: toIso(currentDate.y, currentDate.m, currentDate.d, clock),
        location,
        chamber: "senate",
        url: agenda ? absUrl(pageUrl, agenda) : pageUrl,
      }),
    );
  }
  return events;
}

type MaHearingListItem = { EventId?: number; Details?: string };
type MaHearing = {
  EventId?: number;
  Description?: string;
  Name?: string;
  EventDate?: string;
  StartTime?: string;
  Location?: { LocationName?: string; City?: string };
  HearingHost?: { CommitteeCode?: string };
};

async function fetchMaHearingsApi(): Promise<CalendarEvent[]> {
  const list = await fetchJson<MaHearingListItem[]>("https://malegislature.gov/api/Hearings");
  const ids = [...new Set(list.map((x) => Number(x.EventId)).filter((n) => Number.isFinite(n)))]
    .sort((a, b) => b - a)
    .slice(0, 60);
  const rows = await mapPool(ids, 8, async (id) => {
    try {
      return await fetchJson<MaHearing>(`https://malegislature.gov/api/Hearings/${id}`);
    } catch {
      return null;
    }
  });
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 120);
  const events: CalendarEvent[] = [];
  for (const row of rows) {
    if (!row?.EventId) continue;
    const start = String(row.StartTime || row.EventDate || "");
    if (!start) continue;
    const when = new Date(start);
    if (Number.isNaN(when.getTime()) || when < cutoff || when > horizon) continue;
    const committee = String(row.Name || "").replace(/\s+/g, " ").trim();
    const subject = String(row.Description || "").replace(/\s+/g, " ").trim();
    const title = committee || subject || "Hearing";
    events.push(
      ev({
        sourceId: `ma-${row.EventId}`,
        state: "MA",
        title,
        start,
        location: [row.Location?.LocationName, row.Location?.City].filter(Boolean).join(", "),
        chamber: /senate/i.test(committee) ? "senate" : /house/i.test(committee) ? "house" : "joint",
        url: `https://malegislature.gov/Events/Hearings/Detail/${row.EventId}`,
        description: subject && subject !== title ? subject : "",
        raw: row,
      }),
    );
  }
  return events;
}

type MaSession = {
  EventId?: number;
  Name?: string;
  EventDate?: string;
  StartTime?: string;
  LocationName?: string;
  Status?: string;
};

async function fetchMaSessionsApi(): Promise<CalendarEvent[]> {
  const rows = await fetchJson<MaSession[]>("https://malegislature.gov/api/Sessions", 25000);
  const window = upcomingWindow();
  const events: CalendarEvent[] = [];
  for (const row of rows || []) {
    if (!row?.EventId) continue;
    if (/cancel/i.test(row.Status || "")) continue;
    const start = String(row.StartTime || row.EventDate || "");
    const day = start.slice(0, 10);
    if (!start || day < window.from || day > window.to) continue;
    const title = String(row.Name || "Session").replace(/^Created\s+/i, "").replace(/\s+/g, " ").trim();
    events.push(
      ev({
        sourceId: `ma-session-${row.EventId}`,
        state: "MA",
        title,
        start,
        location: row.LocationName || "",
        chamber: /senate/i.test(title) ? "senate" : /house/i.test(title) ? "house" : "joint",
        url: `https://malegislature.gov/Events/Sessions/Detail/${row.EventId}`,
        raw: row,
      }),
    );
  }
  return events;
}

function parseMa(html: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const re =
    /(\d{1,2}:\d{2}\s*[AP]M)[\s\S]{0,500}?Follow in MyLegislature:\s*([^"]+?)\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})[\s\S]{0,500}?Hearings\/Detail\/(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const parsed = parseHumanDate(m[3]);
    if (!parsed) continue;
    const title = decodeEntities(m[2]).trim();
    events.push(
      ev({
        sourceId: `ma-${m[4]}`,
        state: "MA",
        title,
        start: toIso(parsed.y, parsed.m, parsed.d, m[1]),
        url: `https://malegislature.gov/Events/Hearings/Detail/${m[4]}`,
      }),
    );
  }
  return events;
}

function parseIa(html: string, pageUrl: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const rowRe = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html))) {
    const cells = [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    if (cells.length < 2) continue;
    const when = stripTags(cells[0]);
    const parsed = parseHumanDate(when);
    if (!parsed) continue;
    const time = when.match(/\d{1,2}:\d{2}\s*[AP]M/i)?.[0];
    const title = stripTags(cells[1]);
    const loc = cells[2] ? stripTags(cells[2]) : "";
    const href = cells[1].match(/href="([^"]+)"/)?.[1];
    events.push(
      ev({
        sourceId: hashId("IA", toIso(parsed.y, parsed.m, parsed.d, time), title),
        state: "IA",
        title,
        start: toIso(parsed.y, parsed.m, parsed.d, time),
        location: loc,
        url: href ? absUrl(pageUrl, href) : pageUrl,
      }),
    );
  }
  return events;
}

function parseNc(html: string, pageUrl: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  let currentDate: { y: number; m: number; d: number } | null = null;
  const parts = html.split(/<div class="cal-event row">/);
  for (const part of parts.slice(1)) {
    const dayFull = stripTags(part.match(/cal-event-day-full[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "");
    if (dayFull) currentDate = parseHumanDate(dayFull);
    if (!currentDate) continue;
    const time = part.match(/\d{1,2}:\d{2}\s*[AP]M/i)?.[0];
    const titleCol = part.match(/order-lg-2">([\s\S]*?)<\/div>/i)?.[1] || "";
    const bold = part.match(/font-weight-bold[^>]*>([^<]*)<\/span>/i);
    const chamber = stripTags(bold?.[1] || "").replace(/:$/, "");
    const title = cleanOfficialTitle(stripTags(titleCol) || chamber);
    const id = part.match(/LegislativeCalendarEvent\/(\d+)/)?.[1];
    if (!title || junkOfficialTitle(title)) continue;
    events.push(
      ev({
        sourceId: id ? `nc-${id}` : hashId("NC", toIso(currentDate.y, currentDate.m, currentDate.d, time), title),
        state: "NC",
        title,
        start: toIso(currentDate.y, currentDate.m, currentDate.d, time),
        chamber,
        url: id ? absUrl(pageUrl, `/LegislativeCalendarEvent/${id}`) : pageUrl,
      }),
    );
  }
  return events;
}

function parseGoogleCalendarTemplates(html: string, state: string, pageUrl: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const re = /google\.com\/calendar\/event\?([^"'<\s]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const query = decodeEntities(m[1].replace(/&amp;/g, "&"));
    const params = new URLSearchParams(query);
    const title = decodeEntities((params.get("text") || "").replace(/\+/g, " ")).trim();
    const dates = params.get("dates") || "";
    const loc = decodeEntities((params.get("location") || "").replace(/\+/g, " "));
    const startRaw = dates.split("/")[0] || "";
    const sm = startRaw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
    if (!title || !sm) continue;
    const start = `${sm[1]}-${sm[2]}-${sm[3]}T${sm[4]}:${sm[5]}:${sm[6]}`;
    events.push(
      ev({
        sourceId: hashId(state, start, title),
        state,
        title,
        start,
        location: loc,
        url: pageUrl,
      }),
    );
  }
  return events;
}

function parseGeneric(html: string, pageUrl: string, state: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  events.push(...parseGoogleCalendarTemplates(html, state, pageUrl));
  events.push(...parseJsonLd(html, state, pageUrl));
  events.push(...parseTimeTags(html, state, pageUrl));
  events.push(...parseGenericTableRows(html, pageUrl, state));
  return events;
}

function parseGenericTableRows(html: string, pageUrl: string, state: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html))) {
    const cells = [...row[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((c) =>
      stripTags(c[1]),
    );
    if (cells.length < 2) continue;
    if (cells.some((c) => /^(date|time|committee(?: name)?|location|actions|bill no\.?|author)$/i.test(c))) {
      continue;
    }
    const dateCell = cells.find((c) => parseHumanDate(c));
    const parsed = dateCell ? parseHumanDate(dateCell) : parseHumanDate(cells.join(" "));
    if (!parsed) continue;
    const timeCell = cells.find((c) => /\d{1,2}:\d{2}\s*[ap]\.?m\.?/i.test(c) || /upon call/i.test(c));
    const locCell = cells.find(
      (c) => /\b(room|capitol|street|building|chamber)\b/i.test(c) && !/add to calendar/i.test(c),
    );
    const skip = new Set([dateCell, timeCell, locCell].filter(Boolean) as string[]);
    const nameCell = cells.find(
      (c) =>
        !skip.has(c) &&
        !/^(ab|sb|hb|hr|sr)\s*\.?\s*\d+/i.test(c) &&
        !junkOfficialTitle(cleanOfficialTitle(c)),
    );
    const title = cleanOfficialTitle(nameCell || "");
    if (!title || junkOfficialTitle(title)) continue;
    const clock = (timeCell || "").match(/\d{1,2}:\d{2}\s*[ap]\.?m\.?/i)?.[0];
    const href = row[1].match(/href="([^"]+)"/i)?.[1];
    events.push(
      ev({
        sourceId: hashId(state, toIso(parsed.y, parsed.m, parsed.d, clock), title),
        state,
        title,
        start: toIso(parsed.y, parsed.m, parsed.d, clock),
        location: locCell || "",
        url: href ? absUrl(pageUrl, href) : pageUrl,
      }),
    );
  }
  return events;
}

function parseJsonLd(html: string, state: string, pageUrl: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1]);
      const nodes = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const type = String(node["@type"] || "");
        if (!/event/i.test(type)) continue;
        const start = String(node.startDate || "");
        const title = String(node.name || node.headline || "");
        if (!start || !title) continue;
        events.push(
          ev({
            sourceId: hashId(state, start, title),
            state,
            title,
            start,
            location: typeof node.location === "string" ? node.location : node.location?.name || "",
            url: node.url || pageUrl,
          }),
        );
      }
    } catch {
      /* ignore invalid json-ld */
    }
  }
  return events;
}

function parseTimeTags(html: string, state: string, pageUrl: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const re = /<time[^>]*datetime="([^"]+)"[^>]*>([\s\S]*?)<\/time>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const start = m[1];
    const inner = stripTags(m[2]);
    if (!start || inner.length < 4 || junkOfficialTitle(cleanOfficialTitle(inner))) continue;
    events.push(
      ev({
        sourceId: hashId(state, start, inner),
        state,
        title: inner,
        start,
        url: pageUrl,
      }),
    );
  }
  return events;
}

async function extractIcsFromHtml(html: string, pageUrl: string, state: string): Promise<CalendarEvent[]> {
  const hrefs = [...html.matchAll(/href=["']([^"']+\.ics[^"']*)["']/gi)].map((m) => absUrl(pageUrl, m[1]));
  const unique = [...new Set(hrefs)].slice(0, 4);
  const events: CalendarEvent[] = [];
  for (const href of unique) {
    try {
      const rows = await fetchIcsEvents(href);
      events.push(
        ...rows
          .map((e) => {
            const title = cleanOfficialTitle(e.title);
            return { ...e, state, title, sourceId: e.sourceId || hashId(state, e.start, title) };
          })
          .filter((e) => !junkOfficialTitle(e.title) && !isHiddenMeeting(e)),
      );
    } catch {
      /* skip bad ics */
    }
  }
  return events;
}
