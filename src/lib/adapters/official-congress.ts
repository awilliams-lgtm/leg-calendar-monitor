import { extractBills } from "@/lib/match";
import { parseOfficialAgendaPage } from "@/lib/official-agenda";
import { absUrl, fetchText, mapPool, parseHumanDate, stripTags, toIso } from "@/lib/html";
import { isHiddenMeeting } from "@/lib/hidden";
import { cleanOfficialTitle, junkOfficialTitle } from "@/lib/title";
import { upcomingWindow } from "@/lib/dates";
import type { CalendarEvent } from "@/lib/types";

function ev(partial: Omit<CalendarEvent, "bills" | "state"> & { state: string; bills?: string[] }): CalendarEvent {
  const title = cleanOfficialTitle(partial.title);
  const bills = partial.bills?.length ? partial.bills : extractBills(`${title}\n${partial.description || ""}`);
  return { ...partial, title, bills };
}

function hashId(start: string, title: string): string {
  return `us|${start}|${title}`.toLowerCase().replace(/\s+/g, " ").slice(0, 180);
}

function usable(e: CalendarEvent): boolean {
  return Boolean(e.title && e.start) && !junkOfficialTitle(e.title) && !isHiddenMeeting(e);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function dayId(d: Date): string {
  return `${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${d.getFullYear()}`;
}

function weekOfParam(sunday: Date): string {
  const sat = new Date(sunday);
  sat.setDate(sunday.getDate() + 6);
  return `${dayId(sunday)}_${dayId(sat)}`;
}

function sundaysAhead(weeks: number): Date[] {
  const out: Date[] = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - today.getDay());
  for (let i = 0; i < weeks; i += 1) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i * 7);
    out.push(d);
  }
  return out;
}

function parseDayId(raw: string): { y: number; m: number; d: number } | null {
  const m = raw.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (!m) return null;
  return { y: Number(m[3]), m: Number(m[1]), d: Number(m[2]) };
}

function inWindow(start: string): boolean {
  const day = start.slice(0, 10);
  const { from, to } = upcomingWindow();
  return day >= from && day <= to;
}

function parseHouseDay(html: string, day: { y: number; m: number; d: number }): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const rows = html.split(/<tr\b/i).slice(1);
  for (const row of rows) {
    const eventId = (row.match(/EventID=(\d+)/i) || [])[1];
    if (!eventId) continue;
    const hearing = stripTags((row.match(/title="([^"]+)"/i) || [])[1] || "").replace(/\s+/g, " ").trim();
    const committee = stripTags((row.match(/text-tiny"[^>]*title="([^"]+)"/i) || [])[1] || "").replace(/\s+/g, " ").trim();
    const time = stripTags((row.match(/text-small">\s*([^<]+)/i) || [])[1] || "");
    const loc = stripTags((row.match(/text-small">[\s\S]*?text-small">\s*([^<]+)/i) || [])[1] || "");
    const title = committee && hearing && !hearing.toLowerCase().includes(committee.toLowerCase())
      ? `${committee}: ${hearing}`
      : hearing || committee;
    if (!title) continue;
    const start = toIso(day.y, day.m, day.d, /\d/.test(time) ? time : undefined);
    const id = `us-house-${eventId}`;
    if (byId.has(id) || !inWindow(start)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "US",
        title,
        start,
        location: loc,
        chamber: "house",
        url: `https://docs.house.gov/Committee/Calendar/ByEvent.aspx?EventID=${eventId}`,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

async function fetchHouseCommittees(): Promise<CalendarEvent[]> {
  const weeks = sundaysAhead(8);
  const dayIds = new Set<string>();
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let i = -3; i < 45; i += 1) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dayIds.add(dayId(d));
  }
  const weekly = await mapPool(weeks, 4, async (sunday) => {
    const url = `https://docs.house.gov/committee/calendar/byweek.aspx?weekof=${weekOfParam(sunday)}`;
    try {
      return await fetchText(url, 25000);
    } catch {
      return "";
    }
  });
  for (const html of weekly) {
    for (const m of html.matchAll(/DayID=(\d{8})/gi)) dayIds.add(m[1]);
  }
  const pages = await mapPool([...dayIds], 5, async (id) => {
    const parsed = parseDayId(id);
    if (!parsed) return [] as CalendarEvent[];
    try {
      const html = await fetchText(`https://docs.house.gov/Committee/Calendar/ByDay.aspx?DayID=${id}`, 25000);
      return parseHouseDay(html, parsed);
    } catch {
      return [] as CalendarEvent[];
    }
  });
  const byId = new Map<string, CalendarEvent>();
  for (const batch of pages) {
    for (const row of batch) byId.set(row.sourceId, row);
  }
  return enrichHouseEvents([...byId.values()]);
}

async function enrichHouseEvents(events: CalendarEvent[]): Promise<CalendarEvent[]> {
  return mapPool(events, 4, async (row) => {
    if (!/ByEvent\.aspx\?EventID=/i.test(row.url || "")) return row;
    try {
      const extra = parseOfficialAgendaPage(await fetchText(row.url, 20000), row.url);
      return ev({
        ...row,
        bills: extra.bills.length ? extra.bills : row.bills,
        description: extra.notes || row.description,
      });
    } catch {
      return row;
    }
  });
}

function parseHouseFloor(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const stamp = html.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i,
  );
  const fallback = stamp ? parseHumanDate(stamp[0]) : null;
  const itemRe =
    /(?:the house will (?:meet|convene)|convenes? at|legislative day)[^.<]{0,160}/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(html))) {
    const blob = stripTags(m[0]).replace(/\s+/g, " ").trim();
    const parsed = parseHumanDate(blob) || fallback;
    if (!parsed) continue;
    const time = blob.match(/\d{1,2}:\d{2}\s*[ap]m/i)?.[0];
    const start = toIso(parsed.y, parsed.m, parsed.d, time);
    if (!inWindow(start)) continue;
    const title = "House Floor";
    const id = hashId(start, title);
    if (byId.has(id)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "US",
        title,
        start,
        chamber: "house",
        url: pageUrl,
        allDay: !time,
      }),
    );
  }
  const billRows = html.split(/<tr\b/i).slice(1);
  for (const row of billRows) {
    const title = cleanOfficialTitle(stripTags((row.match(/<a[^>]*>([\s\S]*?)<\/a>/i) || [])[1] || ""));
    if (!title || junkOfficialTitle(title) || title.length < 8) continue;
    if (!/\b(h\.?r\.?|s\.|h\.?j\.?res|h\.?res|s\.?j\.?res)\b/i.test(title) && !/floor|convene|consider/i.test(title)) {
      continue;
    }
    const parsed = parseHumanDate(stripTags(row)) || fallback;
    if (!parsed) continue;
    const start = toIso(parsed.y, parsed.m, parsed.d);
    if (!inWindow(start)) continue;
    const id = hashId(start, `House Floor: ${title}`);
    if (byId.has(id)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "US",
        title: `House Floor: ${title}`,
        start,
        chamber: "house",
        url: pageUrl,
        allDay: true,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

async function fetchHouseFloor(): Promise<CalendarEvent[]> {
  const url = "https://docs.house.gov/floor/Default.aspx";
  return parseHouseFloor(await fetchText(url, 25000), url);
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? stripTags(m[1]) : "";
}

function parseSenateHearingsXml(xml: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  for (const block of xml.split(/<meeting\b/i).slice(1)) {
    const committee = tag(block, "committee");
    const matter = tag(block, "matter");
    if (!committee || /no committee hearings scheduled/i.test(matter)) continue;
    const day = tag(block, "date_iso_8601") || tag(block, "date");
    const parsed = parseHumanDate(day);
    if (!parsed) continue;
    const time = tag(block, "time");
    const clock = time.match(/\d{1,2}:\d{2}/) ? time : undefined;
    const start = toIso(parsed.y, parsed.m, parsed.d, clock);
    if (!inWindow(start)) continue;
    const title = matter && !/^hearing$/i.test(matter) ? `${committee}: ${matter}` : `${committee} hearing`;
    const id = hashId(start, title);
    if (byId.has(id)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "US",
        title,
        start,
        location: tag(block, "room"),
        chamber: "senate",
        url: "https://www.senate.gov/committees/hearings.htm",
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

const SENATE_HEARING_PAGES: { url: string; committee: string }[] = [
  { url: "https://www.agriculture.senate.gov/hearings", committee: "Agriculture" },
  { url: "https://www.appropriations.senate.gov/hearings", committee: "Appropriations" },
  { url: "https://www.armed-services.senate.gov/hearings", committee: "Armed Services" },
  { url: "https://www.banking.senate.gov/hearings", committee: "Banking" },
  { url: "https://www.budget.senate.gov/hearings", committee: "Budget" },
  { url: "https://www.commerce.senate.gov/hearings", committee: "Commerce" },
  { url: "https://www.energy.senate.gov/hearings", committee: "Energy" },
  { url: "https://www.epw.senate.gov/public/index.cfm/hearings", committee: "Environment and Public Works" },
  { url: "https://www.finance.senate.gov/hearings", committee: "Finance" },
  { url: "https://www.foreign.senate.gov/hearings", committee: "Foreign Relations" },
  { url: "https://www.hsgac.senate.gov/hearings", committee: "Homeland Security and Governmental Affairs" },
  { url: "https://www.help.senate.gov/hearings", committee: "Health, Education, Labor and Pensions" },
  { url: "https://www.judiciary.senate.gov/committee-activity/hearings", committee: "Judiciary" },
  { url: "https://www.rules.senate.gov/hearings", committee: "Rules" },
  { url: "https://www.intelligence.senate.gov/hearings", committee: "Intelligence" },
  { url: "https://www.veterans.senate.gov/hearings", committee: "Veterans' Affairs" },
  { url: "https://www.indian.senate.gov/hearings", committee: "Indian Affairs" },
  { url: "https://www.sbc.senate.gov/public/index.cfm/hearings", committee: "Small Business" },
  { url: "https://www.aging.senate.gov/hearings", committee: "Aging" },
];

function parseSenateCommitteePage(html: string, pageUrl: string, committee: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const add = (title: string, start: string, loc: string, href: string) => {
    if (!title || !start || !inWindow(start) || junkOfficialTitle(title)) return;
    const labeled = title.toLowerCase().includes(committee.toLowerCase()) ? title : `${committee}: ${title}`;
    const id = hashId(start, labeled);
    if (byId.has(id)) return;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "US",
        title: labeled,
        start,
        location: loc,
        chamber: "senate",
        url: href || pageUrl,
      }),
    );
  };

  const cardRe =
    /<(?:article|div|li)[^>]{0,200}(?:hearing|event|calendar)[^>]*>([\s\S]{0,2500}?)<\/(?:article|div|li)>/gi;
  let card: RegExpExecArray | null;
  while ((card = cardRe.exec(html))) {
    const block = card[1];
    const dt = (block.match(/datetime="([^"]+)"/i) || [])[1] || "";
    const parsed = parseHumanDate(dt) || parseHumanDate(stripTags(block));
    if (!parsed) continue;
    const time = dt.match(/T(\d{2}:\d{2})/)?.[1] || stripTags(block).match(/\d{1,2}:\d{2}\s*[ap]m/i)?.[0];
    const heading = stripTags(
      (block.match(/<(?:h[1-4]|a)[^>]*>([\s\S]*?)<\/(?:h[1-4]|a)>/i) || [])[1] || "",
    ).replace(/\s+/g, " ").trim();
    const href = (block.match(/href="([^"]+)"/i) || [])[1] || "";
    const loc = stripTags((block.match(/(?:room|location)[^<]{0,80}/i) || [])[0] || "");
    add(heading || `${committee} hearing`, toIso(parsed.y, parsed.m, parsed.d, time), loc, absUrl(pageUrl, href));
  }

  const timeRe = /<time[^>]*datetime="([^"]+)"[^>]*>([\s\S]{0,80}?)<\/time>[\s\S]{0,800}?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let t: RegExpExecArray | null;
  while ((t = timeRe.exec(html))) {
    const parsed = parseHumanDate(t[1]);
    if (!parsed) continue;
    const clock = t[1].match(/T(\d{2}:\d{2})/)?.[1] || stripTags(t[2]).match(/\d{1,2}:\d{2}\s*[ap]m/i)?.[0];
    add(stripTags(t[4]).replace(/\s+/g, " ").trim(), toIso(parsed.y, parsed.m, parsed.d, clock), "", absUrl(pageUrl, t[3]));
  }

  const dtRe = /datetime="(\d{4}-\d{2}-\d{2}[^"]*)"/gi;
  let dt: RegExpExecArray | null;
  while ((dt = dtRe.exec(html))) {
    const parsed = parseHumanDate(dt[1]);
    if (!parsed) continue;
    const around = html.slice(dt.index, dt.index + 900);
    const heading = stripTags((around.match(/<(?:h[1-4]|a)[^>]*>([\s\S]*?)<\/(?:h[1-4]|a)>/i) || [])[1] || "");
    const href = (around.match(/href="([^"]+)"/i) || [])[1] || "";
    const clock = dt[1].match(/T(\d{2}:\d{2})/)?.[1];
    add(heading || `${committee} hearing`, toIso(parsed.y, parsed.m, parsed.d, clock), "", absUrl(pageUrl, href));
  }

  return [...byId.values()].filter(usable);
}

async function fetchSenateCommittees(): Promise<CalendarEvent[]> {
  const byId = new Map<string, CalendarEvent>();
  try {
    const xml = await fetchText("https://www.senate.gov/general/committee_schedules/hearings.xml", 20000);
    for (const row of parseSenateHearingsXml(xml)) byId.set(row.sourceId, row);
  } catch {
    /* daily xml can be empty */
  }
  const pages = await mapPool(SENATE_HEARING_PAGES, 4, async (page) => {
    try {
      const html = await fetchText(page.url, 25000);
      return parseSenateCommitteePage(html, page.url, page.committee);
    } catch {
      return [] as CalendarEvent[];
    }
  });
  for (const batch of pages) {
    for (const row of batch) {
      if (!byId.has(row.sourceId)) byId.set(row.sourceId, row);
    }
  }
  return [...byId.values()];
}

function addSenateFloor(
  byId: Map<string, CalendarEvent>,
  start: string,
  pageUrl: string,
  time?: string,
) {
  if (!inWindow(start) && !recentFloorDay(start)) return;
  const id = hashId(start, "Senate Floor Session");
  if (byId.has(id)) return;
  byId.set(
    id,
    ev({
      sourceId: id,
      state: "US",
      title: "Senate Floor Session",
      start,
      chamber: "senate",
      url: pageUrl,
      allDay: !time,
    }),
  );
}

function recentFloorDay(start: string): boolean {
  const day = start.slice(0, 10);
  const lookback = new Date();
  lookback.setDate(lookback.getDate() - 14);
  const from = lookback.toISOString().slice(0, 10);
  return day >= from && day <= upcomingWindow().to;
}

function parseSenateFloor(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const re =
    /(?:convene|the senate will (?:meet|convene)|senate meets)[^.<]{0,180}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const blob = stripTags(m[0]).replace(/\s+/g, " ").trim();
    const parsed = parseHumanDate(blob);
    if (!parsed) continue;
    const time = blob.match(/\d{1,2}:\d{2}\s*[ap]m/i)?.[0];
    addSenateFloor(byId, toIso(parsed.y, parsed.m, parsed.d, time), pageUrl, time);
  }
  return [...byId.values()].filter(usable);
}

function parseSenateFloorActivity(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const heading = html.match(
    /<h2[^>]*>\s*((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+[^<]+)\s*<\/h2>/i,
  );
  const headingDate = heading ? parseHumanDate(stripTags(heading[1])) : null;
  const called = html.match(/called the Senate to order at\s+(\d{1,2}:\d{2}\s*[ap]\.?m\.?)/i);
  if (headingDate) {
    addSenateFloor(
      byId,
      toIso(headingDate.y, headingDate.m, headingDate.d, called?.[1]),
      pageUrl,
      called?.[1],
    );
  }
  const until = html.match(
    /until\s+(\d{1,2}:\d{2}\s*[ap]\.?m\.?)\s+on\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([^.<]{6,40})/i,
  );
  if (until) {
    const parsed = parseHumanDate(until[3]);
    if (parsed) addSenateFloor(byId, toIso(parsed.y, parsed.m, parsed.d, until[1]), pageUrl, until[1]);
  }
  return [...byId.values()].filter(usable);
}

async function fetchSenateFloor(): Promise<CalendarEvent[]> {
  const byId = new Map<string, CalendarEvent>();
  const pages: Array<{ url: string; parse: (html: string, url: string) => CalendarEvent[] }> = [
    { url: "https://www.senate.gov/legislative/LIS/floor_activity/floor_activity.htm", parse: parseSenateFloorActivity },
    { url: "https://www.senate.gov/legislative/LIS/floor_schedule/week.htm", parse: parseSenateFloor },
    { url: "https://www.senate.gov/legislative/2026_schedule.htm", parse: parseSenateFloor },
  ];
  for (const page of pages) {
    try {
      for (const row of page.parse(await fetchText(page.url, 20000), page.url)) {
        if (!byId.has(row.sourceId)) byId.set(row.sourceId, row);
      }
    } catch {
      /* one floor page can fail */
    }
  }
  return [...byId.values()];
}

export async function fetchCongressMeetings(): Promise<{ events: CalendarEvent[]; notes: string[] }> {
  const notes: string[] = [];
  const byId = new Map<string, CalendarEvent>();
  const add = (rows: CalendarEvent[]) => {
    for (const row of rows) {
      if (!byId.has(row.sourceId)) byId.set(row.sourceId, row);
    }
  };

  try {
    const rows = await fetchHouseCommittees();
    add(rows);
    notes.push(`US house committees → ${rows.length}`);
  } catch (err) {
    notes.push(`US house committees failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const rows = await fetchHouseFloor();
    add(rows);
    notes.push(`US house floor → ${rows.length}`);
  } catch (err) {
    notes.push(`US house floor failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const rows = await fetchSenateCommittees();
    add(rows);
    notes.push(`US senate committees → ${rows.length}`);
  } catch (err) {
    notes.push(`US senate committees failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const rows = await fetchSenateFloor();
    add(rows);
    notes.push(`US senate floor → ${rows.length}`);
  } catch (err) {
    notes.push(`US senate floor failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { events: [...byId.values()].filter(usable), notes };
}
