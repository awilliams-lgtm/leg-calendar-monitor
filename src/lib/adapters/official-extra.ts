import { createHash } from "crypto";
import { parseIcsText } from "@/lib/adapters/ics";
import { fetchCongressMeetings } from "@/lib/adapters/official-congress";
import { extractBills } from "@/lib/match";
import { absUrl, decodeEntities, fetchJson, fetchText, fetchTextPost, mapPool, MONTHS, parseHumanDate, stripTags, toIso } from "@/lib/html";
import { mergeOfficialEvent } from "@/lib/official-merge";
import { fetchPdfText } from "@/lib/pdf-text";
import { upcomingWindow } from "@/lib/dates";
import { STATE_SOURCES, type StateSource } from "@/lib/states";
import { cleanOfficialTitle, completeOfficialTitle, junkOfficialEvent, junkOfficialTitle, withChamberLabel } from "@/lib/title";
import type { CalendarEvent } from "@/lib/types";

function ev(partial: Omit<CalendarEvent, "bills" | "state"> & { state: string; bills?: string[] }): CalendarEvent {
  const title = cleanOfficialTitle(completeOfficialTitle(partial.title, partial.location, partial.description));
  const bills = partial.bills?.length ? partial.bills : extractBills(`${title}\n${partial.description || ""}`);
  return { ...partial, title, bills };
}

function hashId(state: string, start: string, title: string): string {
  return `${state}|${start}|${title}`.toLowerCase().replace(/\s+/g, " ").slice(0, 180);
}

function usable(e: CalendarEvent): boolean {
  return !junkOfficialEvent(e);
}

function collapseSameDayTitle(rows: CalendarEvent[]): CalendarEvent[] {
  const byKey = new Map<string, CalendarEvent>();
  for (const row of rows) {
    const key = `${row.state}|${row.start.slice(0, 10)}|${row.title.toLowerCase()}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    const prevMidnight = /T00:00/.test(prev.start);
    const nextMidnight = /T00:00/.test(row.start);
    if (prevMidnight && !nextMidnight) byKey.set(key, row);
  }
  return [...byKey.values()];
}

export async function fetchOfficialApis(src: StateSource): Promise<{ events: CalendarEvent[]; notes: string[] }> {
  const notes: string[] = [];
  const events: CalendarEvent[] = [];
  const code = src.code;

  if (code === "US") {
    try {
      const pulled = await fetchCongressMeetings();
      events.push(...pulled.events);
      notes.push(...pulled.notes);
    } catch (err) {
      notes.push(`US congress failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "VA") {
    try {
      const rows = await fetchVaMeetings();
      events.push(...rows);
      notes.push(`VA commissions + schedule → ${rows.length}`);
    } catch (err) {
      notes.push(`VA meetings failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "WA") {
    try {
      const rows = await fetchWaMeetings();
      events.push(...rows);
      notes.push(`WA xml → ${rows.length}`);
    } catch (err) {
      notes.push(`WA xml failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      const rows = await fetchWaFloorCalendars();
      events.push(...rows);
      notes.push(`WA FAR floor → ${rows.length}`);
    } catch (err) {
      notes.push(`WA FAR floor failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "ND") {
    const ndRows: CalendarEvent[] = [];
    try {
      const rows = await fetchRssEvents("https://ndlegis.gov/events/feed", "ND");
      ndRows.push(...rows);
      notes.push(`ND rss → ${rows.length}`);
    } catch (err) {
      notes.push(`ND rss failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const canceled = new Set<string>();
    try {
      const pulled = await fetchNdCalendar();
      ndRows.push(...pulled.events);
      for (const key of pulled.canceled) canceled.add(key);
      notes.push(`ND calendar html → ${pulled.events.length}`);
    } catch (err) {
      notes.push(`ND calendar html failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const collapsed = collapseSameDayTitle(
      ndRows.filter((e) => {
        const key = `${e.start.slice(0, 10)}|${e.title.toLowerCase()}`;
        return !canceled.has(key) && !/cancel/i.test(`${e.title} ${e.description || ""}`);
      }),
    );
    events.push(...collapsed);
  }

  if (code === "WY") {
    try {
      const rows = await fetchWyMeetings();
      events.push(...rows);
      notes.push(`WY LSO calendar → ${rows.length}`);
    } catch (err) {
      notes.push(`WY LSO calendar failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "WI") {
    try {
      const rows = await fetchWiCommitteeSchedule();
      events.push(...rows);
      notes.push(`WI committee schedule → ${rows.length}`);
    } catch (err) {
      notes.push(`WI committee schedule failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "KS") {
    try {
      const rows = await fetchKsHearings();
      events.push(...rows);
      notes.push(`KS hearings + interim pdf → ${rows.length}`);
    } catch (err) {
      notes.push(`KS hearings api failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "MI") {
    try {
      const rows = await fetchMiMeetings();
      events.push(...rows);
      notes.push(`MI meetings rss → ${rows.length}`);
    } catch (err) {
      notes.push(`MI meetings rss failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "RI") {
    try {
      const rows = await fetchRiCalendar();
      events.push(...rows);
      notes.push(`RI homepage dots + committee calendar → ${rows.length}`);
    } catch (err) {
      notes.push(`RI legislative calendar failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "WV") {
    try {
      const rows = await fetchWvInterims();
      events.push(...rows);
      notes.push(`WV interim schedule → ${rows.length}`);
    } catch (err) {
      notes.push(`WV interim schedule failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "NJ") {
    try {
      const pulled = await fetchNjCalendar();
      events.push(...pulled.events);
      notes.push(`NJ pub → ${pulled.events.length} from ${pulled.url}`);
    } catch (err) {
      notes.push(`NJ pub failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "AL") {
    try {
      const pulled = await fetchAlMeetings();
      events.push(...pulled.events);
      notes.push(`AL graphql → ${pulled.events.length} (${pulled.tabCounts})`);
    } catch (err) {
      notes.push(`AL graphql failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "SD") {
    try {
      const rows = await fetchSdSchedule();
      events.push(...rows);
      notes.push(`SD schedule api → ${rows.length}`);
    } catch (err) {
      notes.push(`SD schedule api failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "GA") {
    try {
      const rows = await fetchGaMeetings();
      events.push(...rows);
      notes.push(`GA meetings api → ${rows.length}`);
    } catch (err) {
      notes.push(`GA meetings api failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "IN") {
    try {
      const pulled = await fetchInCalendars();
      events.push(...pulled.events);
      notes.push(`IN calendars api → ${pulled.events.length} (${pulled.tabCounts})`);
    } catch (err) {
      notes.push(`IN calendars api failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "NV") {
    try {
      const rows = await fetchNvCalendar();
      events.push(...rows);
      notes.push(`NV calendar → ${rows.length}`);
    } catch (err) {
      notes.push(`NV calendar failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "OR") {
    try {
      const rows = await fetchOrCalendar();
      events.push(...rows);
      notes.push(`OR calendar → ${rows.length}`);
    } catch (err) {
      notes.push(`OR calendar failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "HI") {
    try {
      const rows = await fetchHiHearings();
      events.push(...rows);
      notes.push(`HI hearing notices → ${rows.length}`);
    } catch (err) {
      notes.push(`HI hearing notices failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "OH") {
    try {
      const rows = await fetchOhMeetings();
      events.push(...rows);
      notes.push(`OH solar api → ${rows.length}`);
    } catch (err) {
      notes.push(`OH solar api failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "CO") {
    try {
      const rows = await fetchCoSchedule();
      events.push(...rows);
      notes.push(`CO interim schedule → ${rows.length}`);
    } catch (err) {
      notes.push(`CO interim schedule failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "MO") {
    try {
      const rows = await fetchMoHearings();
      events.push(...rows);
      notes.push(`MO house xml + senate → ${rows.length}`);
    } catch (err) {
      notes.push(`MO hearings failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "FL") {
    try {
      const rows = await fetchFlCalendars();
      events.push(...rows);
      notes.push(`FL calendars → ${rows.length}`);
    } catch (err) {
      notes.push(`FL calendars failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "VT") {
    try {
      const rows = await fetchVtMeetings();
      events.push(...rows);
      notes.push(`VT floor + standing + other meetings → ${rows.length}`);
    } catch (err) {
      notes.push(`VT meetings api failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "NM") {
    try {
      const rows = await fetchNmMeetings();
      events.push(...rows);
      notes.push(`NM what's happening + session → ${rows.length}`);
    } catch (err) {
      notes.push(`NM what's happening failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "AK") {
    try {
      const rows = await fetchAkMeetings();
      events.push(...rows);
      notes.push(`AK meeting schedule → ${rows.length}`);
    } catch (err) {
      notes.push(`AK meeting schedule failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "MS") {
    try {
      const rows = await fetchMsSchedule();
      events.push(...rows);
      notes.push(`MS committee schedule → ${rows.length}`);
    } catch (err) {
      notes.push(`MS committee schedule failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "AR") {
    try {
      const rows = await fetchArMeetings();
      events.push(...rows);
      notes.push(`AR meetings → ${rows.length}`);
    } catch (err) {
      notes.push(`AR meetings failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "NH") {
    try {
      const rows = await fetchNhEvents();
      events.push(...rows);
      notes.push(`NH calendar ws → ${rows.length}`);
    } catch (err) {
      notes.push(`NH calendar ws failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "NY") {
    try {
      const rows = await fetchNyHearings();
      events.push(...rows);
      notes.push(`NY public hearings → ${rows.length}`);
    } catch (err) {
      notes.push(`NY public hearings failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "AZ") {
    try {
      const rows = await fetchAzAlis();
      events.push(...rows);
      notes.push(`AZ alis + interims → ${rows.length}`);
    } catch (err) {
      notes.push(`AZ alis today failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "IL") {
    try {
      const rows = await fetchIlHearings();
      events.push(...rows);
      notes.push(`IL hearings api → ${rows.length}`);
    } catch (err) {
      notes.push(`IL hearings api failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "OK") {
    try {
      const rows = await fetchOkMeetings();
      events.push(...rows);
      notes.push(`OK senate + house interims → ${rows.length}`);
    } catch (err) {
      notes.push(`OK senate meetings failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "ID") {
    try {
      const rows = await fetchIdCalendars();
      events.push(...rows);
      notes.push(`ID calendars → ${rows.length}`);
    } catch (err) {
      notes.push(`ID calendars failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "UT") {
    try {
      const rows = await fetchUtCalendar();
      events.push(...rows);
      notes.push(`UT interim calendar → ${rows.length}`);
    } catch (err) {
      notes.push(`UT interim calendar failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "PA") {
    try {
      const rows = await fetchPaMeetings();
      events.push(...rows);
      notes.push(`PA committee calendars → ${rows.length}`);
    } catch (err) {
      notes.push(`PA committee calendars failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "CT") {
    try {
      const rows = await fetchCtEvents();
      events.push(...rows);
      notes.push(`CT events window → ${rows.length}`);
    } catch (err) {
      notes.push(`CT events window failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "ME") {
    try {
      const rows = await fetchMeWeekly();
      events.push(...rows);
      notes.push(`ME weekly legislative calendar → ${rows.length}`);
    } catch (err) {
      notes.push(`ME weekly legislative calendar failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "LA") {
    try {
      const rows = await fetchLaMeetings();
      events.push(...rows);
      notes.push(`LA committee meetings → ${rows.length}`);
    } catch (err) {
      notes.push(`LA committee meetings failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "SC") {
    try {
      const rows = await fetchScMeetings();
      events.push(...rows);
      notes.push(`SC meetings php → ${rows.length}`);
    } catch (err) {
      notes.push(`SC meetings php failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "NE") {
    try {
      const rows = await fetchNeHearings();
      events.push(...rows);
      notes.push(`NE hearing range → ${rows.length}`);
    } catch (err) {
      notes.push(`NE hearing range failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "MT") {
    try {
      const rows = await fetchMtEvents();
      events.push(...rows);
      notes.push(`MT events ics → ${rows.length}`);
    } catch (err) {
      notes.push(`MT events ics failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "DE") {
    try {
      const rows = await fetchDeMeetings();
      events.push(...rows);
      notes.push(`DE committee meetings json → ${rows.length}`);
    } catch (err) {
      notes.push(`DE committee meetings json failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (code === "TN") {
    try {
      const rows = await fetchTnSchedule();
      events.push(...rows);
      notes.push(`TN schedule → ${rows.length}`);
    } catch (err) {
      notes.push(`TN schedule failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { events: events.filter(usable), notes };
}

export function parseExtraByState(code: string, html: string, pageUrl: string): CalendarEvent[] {
  switch (code) {
    case "KY":
      return parseKy(html, pageUrl);
    case "MN":
      return parseMn(html, pageUrl);
    case "TX":
      return parseTx(html, pageUrl);
    case "IL":
      return parseIl(html, pageUrl);
    case "PA":
      return parsePa(html, pageUrl);
    case "AR":
      return parseAr(html, pageUrl);
    case "NJ":
      return parseNj(html, pageUrl);
    case "NV":
      return parseNv(html, pageUrl);
    case "OR":
      return parseOrHome(html, pageUrl);
    case "CO":
      return parseCo(html, pageUrl);
    case "MO":
      return parseMoHearings(html, pageUrl);
    case "FL":
      return parseFlCalendars(html, pageUrl);
    case "NM":
      return parseNm(html, pageUrl);
    case "AK":
      return parseAk(html, pageUrl);
    case "MS":
      return parseMs(html, pageUrl);
    case "NY":
      return parseNyHearings(html, pageUrl);
    case "RI":
      return parseRi(html, pageUrl);
    case "WV":
      return parseWvSchedule(html, pageUrl);
    case "OK":
      return parseOkSenate(html, pageUrl);
    case "UT":
      return parseUt(html, pageUrl);
    case "VT":
      return parseVtHtml(html, pageUrl);
    case "CT":
      return parseCt(html, pageUrl);
    case "ME":
      return parseMeWeek(html, pageUrl);
    case "LA":
      return parseLa(html, pageUrl);
    case "SC":
      return parseScMeetings(html, pageUrl);
    case "NE":
      return parseNeHearings(html, pageUrl);
    case "MT":
      return parseIcsText(html).map((e) => ({ ...e, state: "MT" })).filter(usable);
    case "DE":
      return parseDeJson(html, pageUrl);
    case "TN":
      return parseTn(html, pageUrl);
    default:
      return [];
  }
}

type AlMeeting = {
  id?: string;
  startDate?: string;
  startTime?: string;
  location?: string;
  title?: string;
  description?: string;
  body?: string | null;
  committeeName?: string | null;
  agendaUrl?: string | null;
  agendaItems?: Array<{ instrumentNbr?: string; shortTitle?: string }>;
};

const AL_TABS: { label: string; body?: "House" | "Senate"; managedInLinx: boolean }[] = [
  { label: "Meetings", managedInLinx: false },
  { label: "House", body: "House", managedInLinx: false },
  { label: "Senate", body: "Senate", managedInLinx: false },
  { label: "Announcements", managedInLinx: true },
];

async function alGraphql(fromIso: string, tab: (typeof AL_TABS)[number]): Promise<AlMeeting[]> {
  const query = `query meetings($body: OrganizationBody, $managedInLinx: Boolean, $autoScroll: Boolean!) {
  meetings(
    where: {
      body: { eq: $body }
      startDate: { gte: "${fromIso}" }
      managedInLinx: { eq: $managedInLinx }
      status: { or: [{ eq: Released }, { eq: null }] }
    }
  ) {
    data {
      id
      startDate
      startTime
      location
      title
      description
      body
      committeeName
      agendaUrl
      agendaItems @skip(if: $autoScroll) {
        instrumentNbr
        shortTitle
      }
    }
    count
  }
}`;
  const res = await fetch("https://alison.legislature.state.al.us/graphql/", {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      Origin: "https://alison.legislature.state.al.us",
      Referer: "https://alison.legislature.state.al.us/todays-schedule",
    },
    body: JSON.stringify({
      query,
      operationName: "meetings",
      variables: {
        autoScroll: false,
        managedInLinx: tab.managedInLinx,
        ...(tab.body ? { body: tab.body } : {}),
      },
    }),
    signal: AbortSignal.timeout(18000),
  });
  const payload = (await res.json()) as {
    data?: { meetings?: { data?: AlMeeting[] } };
    errors?: { message?: string }[];
  };
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message).filter(Boolean).join("; "));
  }
  return payload.data?.meetings?.data || [];
}

function alChamber(body?: string | null): string {
  const v = (body || "").toLowerCase();
  if (v === "house") return "house";
  if (v === "senate") return "senate";
  if (v === "joint") return "joint";
  return "";
}

export async function fetchAlMeetings(): Promise<{ events: CalendarEvent[]; tabCounts: string }> {
  const from = new Date();
  from.setDate(1);
  from.setHours(0, 0, 0, 0);
  const fromIso = from.toISOString();
  const byId = new Map<string, CalendarEvent>();
  const tabCounts: string[] = [];

  for (const tab of AL_TABS) {
    const rows = await alGraphql(fromIso, tab);
    tabCounts.push(`${tab.label} ${rows.length}`);
    for (const row of rows) {
      const id = String(row.id || "").trim();
      const title = row.committeeName || row.title || "Meeting";
      const start = row.startDate || "";
      if (!id || !start || !title) continue;
      if (byId.has(id)) continue;
      const bills = (row.agendaItems || []).map((a) => a.instrumentNbr).filter(Boolean) as string[];
      byId.set(
        id,
        ev({
          sourceId: `al-${id}`,
          state: "AL",
          title,
          start,
          location: row.location || "",
          chamber: alChamber(row.body),
          description: row.description || "",
          url: row.agendaUrl || `https://alison.legislature.state.al.us/todays-schedule?tab=0`,
          bills,
        }),
      );
    }
  }

  return { events: [...byId.values()].filter(usable), tabCounts: tabCounts.join(", ") };
}

type SdMeeting = {
  DocumentId?: number;
  Title?: string;
  InterimYearCommitteeName?: string | null;
  CommitteeFullName?: string | null;
  ConferenceCommitteeName?: string | null;
  Body?: string | null;
  DocumentDate?: string;
  EndDate?: string;
  Room?: string | null;
  NoMeeting?: boolean;
  TBD?: boolean;
  SessionCommitteeId?: number | null;
  InterimYearCommitteeId?: number | null;
  ConferenceCommitteeId?: number | null;
};

function sdChamber(body?: string | null): string {
  const v = (body || "").trim().toLowerCase();
  if (v === "h" || v === "house") return "house";
  if (v === "s" || v === "senate") return "senate";
  if (v === "j" || v === "b" || v === "joint") return "joint";
  return "";
}

function sdCommitteeUrl(row: SdMeeting): string {
  if (row.SessionCommitteeId) return `https://sdlegislature.gov/Session/Committee/${row.SessionCommitteeId}`;
  if (row.InterimYearCommitteeId) return `https://sdlegislature.gov/Interim/Committee/${row.InterimYearCommitteeId}`;
  if (row.ConferenceCommitteeId) {
    return `https://sdlegislature.gov/Session/ConferenceCommittee/${row.ConferenceCommitteeId}`;
  }
  return "https://sdlegislature.gov/";
}

function sdMeetingTitle(row: SdMeeting): string {
  const named =
    row.InterimYearCommitteeName || row.CommitteeFullName || row.ConferenceCommitteeName || "";
  if (named.trim()) return named.trim();
  return String(row.Title || "")
    .replace(/\s+Agenda\s+\d{1,2}\/\d{1,2}\/\d{4}.*$/i, "")
    .trim();
}

export async function fetchSdSchedule(): Promise<CalendarEvent[]> {
  const rows = await fetchJson<SdMeeting[]>("https://sdlegislature.gov/api/Schedule");
  const byId = new Map<string, CalendarEvent>();
  for (const row of rows || []) {
    if (row.NoMeeting) continue;
    const id = String(row.DocumentId || "").trim();
    const title = sdMeetingTitle(row);
    const start = row.DocumentDate || "";
    if (!id || !start || !title) continue;
    if (byId.has(id)) continue;
    const midnight = /T00:00:00/.test(start);
    byId.set(
      id,
      ev({
        sourceId: `sd-${id}`,
        state: "SD",
        title,
        start,
        location: row.Room || "",
        chamber: sdChamber(row.Body),
        url: sdCommitteeUrl(row),
        allDay: Boolean(row.TBD) || midnight,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

type GaMeeting = {
  id?: string;
  start?: string;
  subject?: string;
  location?: string;
  agendaUri?: string | null;
  livestreamUrl?: string | null;
  chamber?: number | string | null;
};

function gaChamber(chamber?: number | string | null, title = ""): string {
  const n = Number(chamber);
  if (n === 1) return "house";
  if (n === 2) return "senate";
  if (/joint/i.test(title)) return "joint";
  return "";
}

function gaMonthStart(monthsAgo: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

async function gaAuthHeader(): Promise<string> {
  const ms = String(Date.now());
  const key = createHash("sha512")
    .update(`QFpCwKfd7fjVEXFFwSu36BwwcP83xYgxLAhLYmKkletvarconst${ms}`)
    .digest("hex");
  const res = await fetch(`https://www.legis.ga.gov/api/authentication/token?key=${key}&ms=${ms}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(18000),
  });
  if (!res.ok) throw new Error(`GA token HTTP ${res.status}`);
  const token = await res.json();
  if (typeof token !== "string" || !token) throw new Error("GA token missing");
  return `Bearer ${token}`;
}

async function gaMeetingsFrom(auth: string, startDate: string): Promise<GaMeeting[]> {
  const res = await fetch(
    `https://www.legis.ga.gov/api/meetings?startDate=${encodeURIComponent(startDate)}`,
    {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: auth,
        Origin: "https://www.legis.ga.gov",
        Referer: "https://www.legis.ga.gov/schedule/all",
      },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!res.ok) throw new Error(`GA meetings HTTP ${res.status}`);
  const rows = (await res.json()) as GaMeeting[];
  return Array.isArray(rows) ? rows : [];
}

export async function fetchGaMeetings(): Promise<CalendarEvent[]> {
  const auth = await gaAuthHeader();
  const startDates = [...new Set([gaMonthStart(0), gaMonthStart(-1)])];
  const pages = await mapPool(startDates, 2, (startDate) => gaMeetingsFrom(auth, startDate));
  const rows = pages.flat();
  const byId = new Map<string, CalendarEvent>();
  for (const row of rows) {
    const id = String(row.id || "").trim();
    const title = String(row.subject || "").trim();
    const start = String(row.start || "").trim();
    if (!id || !title || !start) continue;
    if (byId.has(id)) continue;
    const agenda = String(row.agendaUri || "").replace(/^https\//i, "https://");
    byId.set(
      id,
      ev({
        sourceId: `ga-${createHash("sha1").update(id).digest("hex").slice(0, 16)}`,
        state: "GA",
        title,
        start,
        location: row.location || "",
        chamber: gaChamber(row.chamber, title),
        url: agenda || row.livestreamUrl || "https://www.legis.ga.gov/schedule/all",
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

type InCalendarRow = {
  day_number?: string;
  date?: string;
  convene_time?: string;
  cal_version?: string;
  edition?: string;
  lpid?: string;
};

function parseInDateTime(raw?: string): string {
  const m = String(raw || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return "";
  const pad = (n: string) => n.padStart(2, "0");
  return `${m[3]}-${pad(m[1])}-${pad(m[2])}T${pad(m[4])}:${pad(m[5])}:${pad(m[6] || "00")}`;
}

async function inActiveSession(): Promise<{ year: string; lpid: string }> {
  const payload = await fetchJson<{ years?: { year?: string; lpid?: string; active?: boolean }[] }>(
    "https://iga.in.gov/api/getSessionYears",
  );
  const active = (payload.years || []).find((y) => y.active && y.year && y.lpid);
  if (active?.year && active.lpid) return { year: active.year, lpid: active.lpid };
  return { year: "2026", lpid: "session_2026" };
}

function inLatestByDay(rows: InCalendarRow[]): InCalendarRow[] {
  const byDay = new Map<string, InCalendarRow>();
  for (const row of rows) {
    const day = String(row.day_number || "").trim();
    if (!day) continue;
    const prev = byDay.get(day);
    if (!prev || Number(row.cal_version || 0) > Number(prev.cal_version || 0)) byDay.set(day, row);
  }
  return [...byDay.values()];
}

export async function fetchInCalendars(): Promise<{ events: CalendarEvent[]; tabCounts: string }> {
  const session = await inActiveSession();
  const chambers: { chamber: "house" | "senate"; label: string }[] = [
    { chamber: "house", label: "House" },
    { chamber: "senate", label: "Senate" },
  ];
  const byId = new Map<string, CalendarEvent>();
  const tabCounts: string[] = [];

  for (const { chamber, label } of chambers) {
    const rows = await fetchJson<InCalendarRow[]>(
      `https://iga.in.gov/api/getCalendars?session_lpid=${encodeURIComponent(session.lpid)}&chamber=${chamber}`,
    );
    const latest = inLatestByDay(Array.isArray(rows) ? rows : []);
    tabCounts.push(`${label} ${latest.length}`);
    for (const row of latest) {
      const day = String(Number(row.day_number || "") || row.day_number || "").trim();
      const start = parseInDateTime(row.convene_time) || parseInDateTime(row.date);
      if (!day || !start) continue;
      const id = `in-${chamber}-day${day}`;
      if (byId.has(id)) continue;
      byId.set(
        id,
        ev({
          sourceId: id,
          state: "IN",
          title: `${label} Session Day ${day}`,
          start,
          chamber,
          url: `https://iga.in.gov/session/${session.year}/${chamber}/calendars/${day}/combined`,
        }),
      );
    }
  }

  const interim = await fetchInInterimMeetings(session.year);
  for (const row of interim.events) {
    if (!byId.has(row.sourceId)) byId.set(row.sourceId, row);
  }
  if (interim.events.length) tabCounts.push(`Interim ${interim.events.length}`);

  try {
    const pdfRows = await fetchInInterimPdf(session.year);
    for (const row of pdfRows) {
      if (!byId.has(row.sourceId)) byId.set(row.sourceId, row);
    }
    if (pdfRows.length) tabCounts.push(`Interim PDF ${pdfRows.length}`);
  } catch {
    /* calendar PDF may be empty or moved */
  }

  return { events: [...byId.values()].filter(usable), tabCounts: tabCounts.join(", ") };
}

function parseInInterimPdf(text: string, pageUrl: string): CalendarEvent[] {
  if (/there are no meetings currently scheduled/i.test(text)) return [];
  const byId = new Map<string, CalendarEvent>();
  let month = 0;
  const year = new Date().getFullYear();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const monthHit = MONTHS[line.toLowerCase()];
    if (monthHit) {
      month = monthHit;
      continue;
    }
    const m = line.match(/^(\d{1,2})\s+(.+),\s+([^,]+),\s+(\d{1,2}:\d{2}\s*[AP]M)$/i);
    if (!m || !month) continue;
    const title = cleanOfficialTitle(m[2]);
    if (!title || junkOfficialTitle(title)) continue;
    const start = toIso(year, month, Number(m[1]), m[4]);
    const loc = m[3].trim();
    const id = hashId("IN", start, title);
    if (byId.has(id)) continue;
    const t = title.toLowerCase();
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "IN",
        title,
        start,
        location: loc,
        chamber: /senate chamber/i.test(loc) || /\bsenate\b/.test(t) ? "senate" : /house chamber/i.test(loc) || /\bhouse\b/.test(t) ? "house" : "joint",
        url: pageUrl,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

async function fetchInInterimPdf(year: string): Promise<CalendarEvent[]> {
  const urls = [
    `https://iga.in.gov/pdf-documents/124/${year}/universal/publications/committees/interim/cal_of_meetings.pdf`,
    `https://iga.in.gov/pdf-documents/125/${year}/universal/publications/committees/interim/cal_of_meetings.pdf`,
  ];
  for (const url of urls) {
    try {
      const text = await fetchPdfText(url);
      const rows = parseInInterimPdf(text, url);
      if (rows.length || /calendar of interim meetings/i.test(text)) return rows;
    } catch {
      /* try next assembly number */
    }
  }
  return [];
}

async function fetchInInterimMeetings(year: string): Promise<{ events: CalendarEvent[] }> {
  const byId = new Map<string, CalendarEvent>();
  const endpoints = [
    `https://iga.in.gov/api/getNotices?session_lpid=session_${year}`,
    `https://iga.in.gov/api/getEvents?session_lpid=session_${year}`,
    `https://iga.in.gov/api/getCommitteeEvents?session_lpid=session_${year}`,
  ];
  type InCommittee = { name?: string; type?: string; lpid?: string; chamber_lpid?: string };

  const addJsonMeetings = (raw: unknown, committee: string, chamber: string) => {
    const rows = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw as Record<string, unknown>) : [];
    for (const item of rows) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const title = String(rec.name || rec.title || rec.subject || committee || "").trim();
      const dateRaw = String(rec.meeting_date || rec.date || rec.start || rec.convene_time || rec.event_date || "");
      const parsed = parseHumanDate(dateRaw);
      const start = parseInDateTime(dateRaw) || (parsed ? toIso(parsed.y, parsed.m, parsed.d, String(rec.time || rec.meeting_time || "")) : "");
      if (!title || !start) continue;
      const id = hashId("IN", start, title);
      if (byId.has(id)) continue;
      byId.set(
        id,
        ev({
          sourceId: id,
          state: "IN",
          title,
          start,
          chamber: chamber.includes("senate") ? "senate" : chamber.includes("house") ? "house" : "joint",
          url: `https://iga.in.gov/legislative/${year}/committees/`,
        }),
      );
    }
  };

  for (const url of endpoints) {
    try {
      addJsonMeetings(await fetchJson(url), "", "");
    } catch {
      /* endpoint may not exist */
    }
  }

  let committees: InCommittee[] = [];
  try {
    const payload = await fetchJson<{ committees?: InCommittee[] }>(
      `https://iga.in.gov/api/getCommittees?session_lpid=session_${year}`,
    );
    committees = (payload.committees || []).filter((c) => /interim|task|study|oversight|council/i.test(`${c.type} ${c.name}`));
  } catch {
    committees = [];
  }

  const pages = await mapPool(committees.slice(0, 40), 4, async (com) => {
    const lpid = com.lpid;
    if (!lpid) return [] as CalendarEvent[];
    const urls = [
      `https://iga.in.gov/api/getCommittee?lpid=${encodeURIComponent(lpid)}`,
      `https://iga.in.gov/api/getCommitteeMeetings?committee_lpid=${encodeURIComponent(lpid)}`,
      `https://iga.in.gov/legislative/${year}/committees/${encodeURIComponent(lpid)}`,
    ];
    const found: CalendarEvent[] = [];
    for (const url of urls) {
      try {
        if (url.includes("/api/")) {
          addJsonMeetings(await fetchJson(url), com.name || "", com.chamber_lpid || "");
          continue;
        }
        const body = await fetchText(url, 20000);
        if (body.length < 800 && /<!doctype html/i.test(body)) continue;
        const parsedDates =
          body.match(
            /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+2026\b/gi,
          ) || [];
        for (const raw of parsedDates.slice(0, 6)) {
          const parsed = parseHumanDate(raw);
          if (!parsed) continue;
          const title = com.name || "Interim committee";
          const start = toIso(parsed.y, parsed.m, parsed.d);
          found.push(
            ev({
              sourceId: hashId("IN", start, title),
              state: "IN",
              title,
              start,
              chamber: /senate/i.test(com.chamber_lpid || "") ? "senate" : /house/i.test(com.chamber_lpid || "") ? "house" : "joint",
              url: `https://iga.in.gov/legislative/${year}/committees/${lpid}`,
            }),
          );
        }
        if (found.length) break;
      } catch {
        /* try next url */
      }
    }
    return found;
  });
  for (const batch of pages) {
    for (const row of batch) {
      if (!byId.has(row.sourceId)) byId.set(row.sourceId, row);
    }
  }
  return { events: [...byId.values()].filter(usable) };
}

const NV_CAL = "https://www.leg.state.nv.us/App/Calendar/A/";

function nvChamber(title: string): string {
  const t = title.toLowerCase();
  if (/\bjoint\b/.test(t)) return "joint";
  if (/\bassembly\b/.test(t)) return "house";
  if (/\bsenate\b/.test(t)) return "senate";
  return "";
}

function parseNv(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const chunks = html.split(/<div class="h6 textOffWhite bg-nvBlue[^"]*"[^>]*>/i);
  for (const chunk of chunks.slice(1)) {
    const dateEnd = chunk.search(/<\/div>/i);
    if (dateEnd < 0) continue;
    const parsed = parseHumanDate(stripTags(chunk.slice(0, dateEnd)));
    if (!parsed) continue;
    const rows = chunk.split(/<div class="row py-4">/i).slice(1);
    for (const row of rows) {
      const time = stripTags((row.match(/broadcastText[^>]*>\s*([^<]+)/i) || [])[1] || "").trim();
      const link = row.match(/adjRemFont[^>]*>\s*<a href=['"]([^'"]+)['"][^>]*>([^<]+)/i);
      const plain = row.match(/adjRemFont[^>]*>(?:<a[^>]*>)?([^<]+)/i);
      const title = stripTags(link?.[2] || plain?.[1] || "").trim();
      if (!title) continue;
      const loc = stripTags((row.match(/<li>([\s\S]*?)<\/li>/i) || [])[1] || "").trim();
      const start = toIso(parsed.y, parsed.m, parsed.d, /\d/.test(time) ? time : undefined);
      const id = hashId("NV", start, title);
      if (byId.has(id)) continue;
      byId.set(
        id,
        ev({
          sourceId: id,
          state: "NV",
          title,
          start,
          location: loc,
          chamber: nvChamber(title),
          url: link?.[1] || pageUrl,
          allDay: !/\d/.test(time),
        }),
      );
    }
  }
  return [...byId.values()].filter(usable);
}

export async function fetchNvCalendar(): Promise<CalendarEvent[]> {
  const html = await fetchText(NV_CAL);
  return parseNv(html, NV_CAL);
}

const OR_HOME = "https://www.oregonlegislature.gov/";
const OR_BUILDING = /\b(exhibit|public building tour|building tour|welcome center|galleria)\b/i;

function parseOrStamp(raw?: string): string {
  const m = String(raw || "").match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i,
  );
  if (!m) return "";
  const time = m[4] ? `${m[4]}:${m[5]} ${m[7] || ""}`.trim() : undefined;
  return toIso(Number(m[3]), Number(m[1]), Number(m[2]), time);
}

function parseOrHome(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const re = /data-json="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let row: {
      StartTime?: string;
      Title?: string;
      Location?: string;
      Description?: string;
      Sponsor?: string;
    };
    try {
      row = JSON.parse(decodeEntities(m[1])) as typeof row;
    } catch {
      continue;
    }
    const title = String(row.Title || "").trim();
    if (!title || OR_BUILDING.test(title)) continue;
    const start = parseOrStamp(row.StartTime);
    if (!start) continue;
    const id = hashId("OR", start, title);
    if (byId.has(id)) continue;
    const t = title.toLowerCase();
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "OR",
        title,
        start,
        location: row.Location || "",
        chamber: /\bjoint\b/.test(t) ? "joint" : /\bsenate\b/.test(t) ? "senate" : /\bhouse\b/.test(t) ? "house" : "",
        url: pageUrl,
        description: row.Description || "",
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

type OrMeeting = {
  SessionKey?: string;
  CommitteeCode?: string;
  MeetingDate?: string;
  Location?: string;
  AlternateLocation?: string;
  AgendaUrl?: string;
  MeetingStatus?: string;
  MeetingStatusCode?: string;
  MeetingGuid?: string;
};

type OrCommittee = {
  SessionKey?: string;
  CommitteeCode?: string;
  CommitteeName?: string;
  HouseOfAction?: string;
  CommitteeType?: string;
};

type OrConvene = {
  SessionKey?: string;
  SessionDate?: string;
  Chamber?: string;
};

async function fetchOrOdataList<T>(path: string, query: string): Promise<T[]> {
  const out: T[] = [];
  for (let skip = 0; skip < 500; skip += 100) {
    const url = `https://api.oregonlegislature.gov/odata/ODataService.svc/${path}?${query}&$top=100&$skip=${skip}&$format=json`;
    const data = await fetchJson<{ value?: T[] }>(url, 25000);
    const rows = data.value || [];
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

function orOdataStamp(daysBack: number): string {
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - daysBack);
  return `${from.toISOString().slice(0, 10)}T00:00:00`;
}

function orChamber(raw?: string): string {
  const v = (raw || "").toUpperCase();
  if (v === "S" || v.includes("SENATE")) return "senate";
  if (v === "H" || v.includes("HOUSE")) return "house";
  if (v === "J" || v.includes("JOINT")) return "joint";
  return "";
}

async function fetchOrOdata(): Promise<CalendarEvent[]> {
  const stamp = orOdataStamp(90);
  const meetings = await fetchOrOdataList<OrMeeting>(
    "CommitteeMeetings",
    `$filter=MeetingDate ge datetime'${stamp}'&$orderby=MeetingDate`,
  );
  const sessions = [...new Set(meetings.map((row) => row.SessionKey).filter(Boolean))] as string[];
  const committees = new Map<string, OrCommittee>();
  for (const session of sessions) {
    const rows = await fetchOrOdataList<OrCommittee>(
      "Committees",
      `$filter=SessionKey eq '${session}'`,
    );
    for (const row of rows) {
      committees.set(`${row.SessionKey}|${row.CommitteeCode}`, row);
    }
  }
  const byId = new Map<string, CalendarEvent>();
  for (const row of meetings) {
    if (/cancel/i.test(row.MeetingStatus || "") || row.MeetingStatusCode === "C") continue;
    const start = row.MeetingDate || "";
    if (!start) continue;
    const com = committees.get(`${row.SessionKey}|${row.CommitteeCode}`);
    const name = (com?.CommitteeName || row.CommitteeCode || "Committee").trim();
    const kind = (com?.CommitteeType || "").trim();
    const title = kind && !name.toLowerCase().startsWith(kind.toLowerCase()) ? `${kind} ${name}` : name;
    const id = row.MeetingGuid ? `or-${row.MeetingGuid}` : hashId("OR", start, title);
    if (byId.has(id)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "OR",
        title,
        start,
        location: row.AlternateLocation || row.Location || "",
        chamber: orChamber(com?.HouseOfAction) || orChamber(row.CommitteeCode?.slice(0, 1)),
        url: row.AgendaUrl || "https://www.oregonlegislature.gov/",
      }),
    );
  }
  try {
    const convene = await fetchOrOdataList<OrConvene>(
      "ConveneTimes",
      `$filter=SessionDate ge datetime'${stamp}'&$orderby=SessionDate`,
    );
    for (const row of convene) {
      const start = row.SessionDate || "";
      if (!start) continue;
      const chamber = orChamber(row.Chamber);
      const title = chamber === "senate" ? "Senate Floor Session" : chamber === "house" ? "House Floor Session" : "Floor Session";
      const id = hashId("OR", start, title);
      if (byId.has(id)) continue;
      byId.set(
        id,
        ev({
          sourceId: id,
          state: "OR",
          title,
          start,
          chamber,
          url: "https://www.oregonlegislature.gov/",
        }),
      );
    }
  } catch {
    /* floor times are optional if committee meetings already loaded */
  }
  return [...byId.values()].filter(usable);
}

export async function fetchOrCalendar(): Promise<CalendarEvent[]> {
  try {
    const odata = await fetchOrOdata();
    if (odata.length) return odata;
  } catch {
    /* homepage is the Floor + Committees widget fallback */
  }
  const home = parseOrHome(await fetchText(OR_HOME), OR_HOME);
  return home.filter(usable);
}

const HI_NOTICES = "https://data.capitol.hawaii.gov/sessions/session2026/hearingnotices/";

export async function fetchHiHearings(): Promise<CalendarEvent[]> {
  const html = await fetchText(HI_NOTICES);
  const files = [...html.matchAll(/(?:HEARING|CONF)_([A-Z0-9\-]+)_(\d{2})-(\d{2})-(\d{2})[^"<\s]*\.HTM/gi)];
  const cutoff = Date.now() - 240 * 24 * 3600 * 1000;
  const recent: { file: string; start: string; title: string }[] = [];
  const seenFile = new Set<string>();
  for (const m of files) {
    const file = m[0];
    if (seenFile.has(file)) continue;
    seenFile.add(file);
    const year = 2000 + Number(m[4]);
    const start = toIso(year, Number(m[2]), Number(m[3]));
    if (Number.isNaN(Date.parse(start)) || Date.parse(start) < cutoff) continue;
    recent.push({ file, start, title: `${m[1].replace(/-/g, "/")} hearing` });
  }
  recent.sort((a, b) => b.start.localeCompare(a.start));
  const byId = new Map<string, CalendarEvent>();
  for (const row of recent.slice(0, 80)) {
    const id = hashId("HI", row.start, row.file);
    if (byId.has(id)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "HI",
        title: row.title,
        start: row.start,
        url: absUrl(HI_NOTICES, row.file),
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

type OhCommittee = { lpid?: string; name?: string; chamber?: string };
type OhMeeting = {
  meeting_date?: string;
  meeting_time?: string;
  location?: string;
  meeting_id?: string;
  canceled?: boolean;
};

export async function fetchOhMeetings(): Promise<CalendarEvent[]> {
  const committees = await fetchJson<{ items?: OhCommittee[] } | OhCommittee[]>(
    "https://search-prod.lis.state.oh.us/api/v2/general_assembly_136/committees/",
  );
  const list = Array.isArray(committees) ? committees : committees.items || [];
  const events: CalendarEvent[] = [];
  const cutoff = Date.now() - 180 * 24 * 3600 * 1000;
  const pages = await mapPool(list, 5, async (com) => {
    const lpid = com.lpid;
    if (!lpid) return [] as CalendarEvent[];
    try {
      const payload = await fetchJson<{ items?: OhMeeting[] } | OhMeeting[]>(
        `https://search-prod.lis.state.oh.us/api/v2/general_assembly_136/committees/${encodeURIComponent(lpid)}/meetings/`,
      );
      const rows = Array.isArray(payload) ? payload : payload.items || [];
      return rows
        .filter((row) => !row.canceled)
        .map((row) => {
          const day = row.meeting_date || "";
          if (day && Date.parse(day) < cutoff) return null;
          const hhmm = (row.meeting_time || "").match(/^(\d{1,2}):(\d{2})$/);
          const start = hhmm ? `${day}T${hhmm[1].padStart(2, "0")}:${hhmm[2]}:00` : day;
          const title = com.name || "Committee meeting";
          return ev({
            sourceId: row.meeting_id ? `oh-${row.meeting_id}` : hashId("OH", start, title),
            state: "OH",
            title,
            start,
            location: row.location || "",
            chamber: (com.chamber || "").toLowerCase().includes("senate")
              ? "senate"
              : (com.chamber || "").toLowerCase().includes("house")
                ? "house"
                : "",
            url: `https://www.legislature.ohio.gov/schedules/session-schedule`,
          });
        })
        .filter((e): e is CalendarEvent => Boolean(e?.start));
    } catch {
      return [] as CalendarEvent[];
    }
  });
  for (const batch of pages) events.push(...batch);
  return events.filter(usable);
}

const CO_SCHEDULE = "https://leg.colorado.gov/schedule";

function parseCo(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const parts = html.split(/<h3\b[^>]*>/i);
  for (const part of parts.slice(1)) {
    const headingEnd = part.search(/<\/h3>/i);
    if (headingEnd < 0) continue;
    const parsed = parseHumanDate(stripTags(part.slice(0, headingEnd)));
    if (!parsed) continue;
    const body = part.slice(headingEnd);
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let row: RegExpExecArray | null;
    while ((row = rowRe.exec(body))) {
      const cells = [...row[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((c) =>
        stripTags(c[1]),
      );
      if (cells.length < 2) continue;
      if (/^(time|activity|location|agenda|audio)$/i.test(cells[0])) continue;
      const title = cleanOfficialTitle(cells[1] || "");
      if (!title || junkOfficialTitle(title)) continue;
      const time = (cells[0] || "").match(/\d{1,2}:\d{2}\s*[ap]m/i)?.[0];
      const start = toIso(parsed.y, parsed.m, parsed.d, time);
      const href = row[1].match(/href="([^"]+)"/i)?.[1];
      const id = hashId("CO", start, title);
      if (byId.has(id)) continue;
      byId.set(
        id,
        ev({
          sourceId: id,
          state: "CO",
          title,
          start,
          location: cells[2] || "",
          url: href ? absUrl(pageUrl, href) : pageUrl,
        }),
      );
    }
  }
  return [...byId.values()].filter(usable);
}

export async function fetchCoSchedule(): Promise<CalendarEvent[]> {
  return parseCo(await fetchText(CO_SCHEDULE), CO_SCHEDULE);
}

const MO_HOUSE_HEARINGS = "https://house.mo.gov/HearingsTimeOrder.aspx";
const MO_SENATE_HEARINGS = "https://www.senate.mo.gov/hearingsschedule/hrings.htm";
const MO_SESSION_JS = "https://documents.house.mo.gov/SessionSet.js";
const MO_XML_BASE = "https://documents.house.mo.gov/xml/";

function clockTime(raw: string): string {
  return (raw || "")
    .replace(/\./g, "")
    .replace(/(\d{1,2}:\d{2}):\d{2}/, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLooseDate(text: string, fallbackYear = new Date().getFullYear()) {
  const parsed = parseHumanDate(text, fallbackYear);
  if (parsed) return parsed;
  const md = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (md) return { y: fallbackYear, m: Number(md[1]), d: Number(md[2]) };
  return null;
}

function chamberFromTitle(title: string, fallback = ""): string {
  const t = title.toLowerCase();
  if (/\bjoint\b/.test(t)) return "joint";
  if (/\bsenate\b/.test(t) && !/\bhouse\b/.test(t)) return "senate";
  if (/\bhouse\b/.test(t) && !/\bsenate\b/.test(t)) return "house";
  return fallback;
}

function parseMoHearings(html: string, pageUrl: string): CalendarEvent[] {
  const senate = /senate\.mo\.gov/i.test(pageUrl);
  return senate ? parseMoSenate(html, pageUrl) : parseMoHouse(html, pageUrl);
}

async function moHouseXmlUrl(): Promise<string> {
  const js = await fetchText(MO_SESSION_JS, 12000);
  const year = js.match(/var\s+sessionyearcode\s*=\s*'(\d+)'/)?.[1];
  if (!year) throw new Error("MO sessionyearcode missing");
  return `${MO_XML_BASE}${year}-UpcomingHearingList.XML`;
}

function parseMoHouseXml(xml: string, pageUrl: string): CalendarEvent[] {
  if (!/<ROOT\b|<HearingInfo\b/i.test(xml)) throw new Error("MO house xml was not a hearing list");
  const byId = new Map<string, CalendarEvent>();
  const blocks = xml.split(/<HearingInfo>/i).slice(1);
  for (const block of blocks) {
    if (/<HearingStatus>\s*Cancel/i.test(block)) continue;
    const title = cleanOfficialTitle(tag(block, "CommitteeName"));
    const dateText = tag(block, "HearingDate");
    const timeText = tag(block, "HearingTime");
    const loc = tag(block, "HearingLocation");
    const parsed = parseHumanDate(dateText) || parseLooseDate(dateText);
    if (!parsed || !title || junkOfficialTitle(title)) continue;
    const start = toIso(parsed.y, parsed.m, parsed.d, clockTime(timeText));
    const hearingId = tag(block, "HearingID");
    const id = hearingId ? `mo-h-${hearingId}` : hashId("MO", start, title);
    if (byId.has(id)) continue;
    const bills = [...block.matchAll(/<CurrentBillString>([\s\S]*?)<\/CurrentBillString>/gi)]
      .map((m) => stripTags(m[1]).trim())
      .filter(Boolean);
    const comments = tag(block, "Comments");
    const chairChamber = tag(block, "CommitteeChairChamber");
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "MO",
        title,
        start,
        location: loc,
        chamber: chamberFromTitle(title, /senate/i.test(chairChamber) ? "senate" : "house"),
        url: pageUrl,
        description: [comments, bills.join(", ")].filter(Boolean).join(" · "),
        bills: bills.length ? bills : undefined,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

function parseMoHouse(html: string, pageUrl: string): CalendarEvent[] {
  const text = stripTags(html);
  const byId = new Map<string, CalendarEvent>();
  const blockRe =
    /Hearing Date\s+([A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+\d{4})(?:\s+\*+Corrected\*+)?\s+Committee:\s*(.+?)\s+Chair:[\s\S]*?Time:\s*(\d{1,2}:\d{2}\s*[ap]m)\s+Location:\s*(.+?)(?:\s+Note:|\s+Hearing Date|$)/gi;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(text))) {
    const parsed = parseHumanDate(block[1]);
    const title = cleanOfficialTitle(block[2]);
    if (!parsed || !title || junkOfficialTitle(title)) continue;
    const start = toIso(parsed.y, parsed.m, parsed.d, clockTime(block[3]));
    const id = hashId("MO", start, title);
    if (byId.has(id)) continue;
    const t = title.toLowerCase();
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "MO",
        title,
        start,
        location: block[4].trim(),
        chamber: /\bjoint\b/.test(t) ? "joint" : /\bsenate\b/.test(t) ? "senate" : "house",
        url: pageUrl,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

function parseMoSenate(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const blocks = html.split(/Committee:\s*/i).slice(1);
  for (const block of blocks) {
    const titleHtml = block.match(/<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] || "";
    const rawTitle = stripTags(titleHtml).replace(/,\s*(?:Senator|Rep\.|Representative)\b[\s\S]*$/i, "");
    const title = cleanOfficialTitle(rawTitle);
    const dateText = stripTags(block.match(/Date:<\/b>\s*(?:&nbsp;)*\s*([^<]+)/i)?.[1] || "");
    const timeText = stripTags(block.match(/Time:<\/b>\s*(?:&nbsp;)*\s*([^<]+)/i)?.[1] || "");
    const loc = stripTags(block.match(/Room:<\/b>\s*(?:&nbsp;)*\s*([^<]+)/i)?.[1] || "");
    const parsed = parseHumanDate(dateText);
    if (!parsed || !title || junkOfficialTitle(title)) continue;
    const start = toIso(parsed.y, parsed.m, parsed.d, clockTime(timeText));
    const id = hashId("MO", start, title);
    if (byId.has(id)) continue;
    const t = title.toLowerCase();
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "MO",
        title,
        start,
        location: loc.trim(),
        chamber: /\bjoint\b/.test(t) ? "joint" : "senate",
        url: pageUrl,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

export async function fetchMoHearings(): Promise<CalendarEvent[]> {
  const byId = new Map<string, CalendarEvent>();
  const errors: string[] = [];
  let loaded = 0;

  try {
    const xmlUrl = await moHouseXmlUrl();
    for (const row of parseMoHouseXml(await fetchText(xmlUrl), MO_HOUSE_HEARINGS)) byId.set(row.sourceId, row);
    loaded += 1;
  } catch (err) {
    errors.push(`house xml: ${err instanceof Error ? err.message : String(err)}`);
    try {
      for (const row of parseMoHouse(await fetchText(MO_HOUSE_HEARINGS), MO_HOUSE_HEARINGS)) byId.set(row.sourceId, row);
      loaded += 1;
    } catch (htmlErr) {
      errors.push(`house html: ${htmlErr instanceof Error ? htmlErr.message : String(htmlErr)}`);
    }
  }

  try {
    for (const row of parseMoSenate(await fetchText(MO_SENATE_HEARINGS), MO_SENATE_HEARINGS)) byId.set(row.sourceId, row);
    loaded += 1;
  } catch (err) {
    errors.push(`senate: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!loaded) throw new Error(errors.join("; ") || "MO hearings fetch failed");
  return [...byId.values()];
}

const FL_SENATE_CAL = "https://www.flsenate.gov/Session/Calendars/2026";
const FL_HOUSE_CAL = "https://www.flhouse.gov/Sections/HouseSchedule/houseschedule.aspx";

function parseFlCalendars(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const pdfs = [...html.matchAll(/href="([^"]*Calendar[^"]*(\d{4}-\d{2}-\d{2})[^"]*\.PDF)"/gi)];
  for (const m of pdfs) {
    const start = `${m[2]}T00:00:00`;
    const house = /house/i.test(pageUrl);
    const title = house ? "House Daily Calendar" : "Senate Daily Calendar";
    const id = hashId("FL", start, title);
    if (byId.has(id)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "FL",
        title,
        start,
        chamber: house ? "house" : "senate",
        url: absUrl(pageUrl, m[1]),
      }),
    );
  }
  const cards = html.split(/class="[^"]*schedule-event[^"]*"/i).slice(1);
  for (const card of cards) {
    const title = cleanOfficialTitle(stripTags(card.match(/scheduled-event-title[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || ""));
    const info = stripTags(card.match(/class="[^"]*meeting-info[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "");
    const parsed = parseHumanDate(info);
    if (!title || !parsed || junkOfficialTitle(title)) continue;
    const time = info.match(/\d{1,2}:\d{2}\s*[ap]m/i)?.[0];
    const loc = info
      .replace(/\d{1,2}\/\d{1,2}\/\d{4}/, "")
      .replace(/\d{1,2}:\d{2}\s*[ap]m(?:\s*-\s*\d{1,2}:\d{2}\s*[ap]m)?/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const href = card.match(/href="([^"]*MeetingId=\d+[^"]*)"/i)?.[1];
    const meetingId = href?.match(/MeetingId=(\d+)/i)?.[1];
    const start = toIso(parsed.y, parsed.m, parsed.d, time);
    const id = meetingId ? `fl-house-${meetingId}` : hashId("FL", start, title);
    if (byId.has(id)) continue;
    const t = title.toLowerCase();
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "FL",
        title,
        start,
        location: loc.slice(0, 120),
        chamber: /\bsenate\b/.test(t) && !/\bhouse\b/.test(t) ? "senate" : /\bjoint\b/.test(t) ? "joint" : "house",
        url: href ? absUrl(pageUrl, href) : pageUrl,
      }),
    );
  }
  const parts = html.split(/<h[23]\b[^>]*>/i);
  for (const part of parts.slice(1)) {
    const headingEnd = part.search(/<\/h[23]>/i);
    if (headingEnd < 0) continue;
    const parsed = parseHumanDate(stripTags(part.slice(0, headingEnd)));
    if (!parsed) continue;
    const body = part.slice(headingEnd);
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let row: RegExpExecArray | null;
    while ((row = rowRe.exec(body))) {
      if (/<th\b/i.test(row[1]) && !/<td\b/i.test(row[1])) continue;
      const cells = [...row[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((c) =>
        stripTags(c[1]),
      );
      if (cells.length < 2) continue;
      const title = cleanOfficialTitle(
        cells
          .filter((c) => c.length > 4 && !parseHumanDate(c) && !/^\d{1,2}:\d{2}/.test(c) && !/^start time\b/i.test(c))
          .sort((a, b) => b.length - a.length)[0] || "",
      );
      if (!title || junkOfficialTitle(title)) continue;
      const href = row[1].match(/href="([^"]+)"/i)?.[1] || "";
      if (/VideoPlayer\.aspx/i.test(href) && !/MeetingId=/i.test(href)) continue;
      if (
        !/MeetingId=/i.test(href) &&
        !/\b(committee|commission|subcommittee|session|hearing|caucus|briefing)\b/i.test(title)
      ) {
        continue;
      }
      const time = cells.join(" ").match(/\d{1,2}:\d{2}\s*[ap]m/i)?.[0];
      const start = toIso(parsed.y, parsed.m, parsed.d, time);
      const id = hashId("FL", start, title);
      if (byId.has(id)) continue;
      byId.set(
        id,
        ev({
          sourceId: id,
          state: "FL",
          title,
          start,
          chamber: /senate/i.test(title) ? "senate" : /house/i.test(title) ? "house" : "",
          url: href ? absUrl(pageUrl, href) : pageUrl,
        }),
      );
    }
  }
  return [...byId.values()].filter(usable);
}

function flHouseStamp(d: Date): string {
  return `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`;
}

function flHouseUrl(d: Date): string {
  return `${FL_HOUSE_CAL}?date=${flHouseStamp(d)}`;
}

function flWeekdays(from: Date, to: Date): Date[] {
  const dates: Date[] = [];
  const cursor = new Date(from);
  cursor.setHours(12, 0, 0, 0);
  const end = new Date(to);
  end.setHours(12, 0, 0, 0);
  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export async function fetchFlCalendars(): Promise<CalendarEvent[]> {
  const byId = new Map<string, CalendarEvent>();
  const add = (rows: CalendarEvent[]) => {
    for (const row of rows) {
      if (!byId.has(row.sourceId)) byId.set(row.sourceId, row);
    }
  };

  try {
    add(parseFlCalendars(await fetchText(FL_SENATE_CAL), FL_SENATE_CAL));
  } catch {
    /* senate page can fail without dropping house */
  }

  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const nearFrom = new Date(today);
  nearFrom.setDate(today.getDate() - 10);
  const nearTo = new Date(today);
  nearTo.setDate(today.getDate() + 21);
  const sessionFrom = new Date(today.getFullYear(), 0, 6);
  const sessionTo = new Date(today.getFullYear(), 2, 20);
  const dates = new Map<string, Date>();
  for (const d of [...flWeekdays(sessionFrom, sessionTo), ...flWeekdays(nearFrom, nearTo)]) {
    dates.set(flHouseStamp(d), d);
  }

  const pages = await mapPool([...dates.values()], 6, async (day) => {
    const url = flHouseUrl(day);
    try {
      return parseFlCalendars(await fetchText(url, 10000), url);
    } catch {
      return [] as CalendarEvent[];
    }
  });
  for (const rows of pages) add(rows);

  return [...byId.values()];
}

type VtMeeting = {
  MeetingDate?: string;
  CommitteeMeetingID?: string;
  CommName?: string;
  LongName?: string;
  StartTime?: string | number;
  TimeSlot?: string | number;
  Room?: string;
  BuildingName?: string;
  CommitteeType?: string;
  StandardDate?: string;
  Published?: string | number;
  PermanentID?: string;
};

function vtPad(n: number): string {
  return String(n).padStart(2, "0");
}

function vtDayKey(parsed: { y: number; m: number; d: number }): string {
  return `${parsed.y}-${vtPad(parsed.m)}-${vtPad(parsed.d)}`;
}

function vtDayInWindow(day: string, now = new Date()): boolean {
  const window = upcomingWindow(now);
  const lookback = new Date(now);
  lookback.setDate(lookback.getDate() - 2);
  const from = `${lookback.getFullYear()}-${vtPad(lookback.getMonth() + 1)}-${vtPad(lookback.getDate())}`;
  return Boolean(day && day >= from && day <= window.to);
}

function vtClock(raw: unknown): string {
  if (typeof raw === "number") return "";
  const text = String(raw || "").trim();
  if (!text || text === "1") return "";
  return clockTime(text);
}

/** Standing committees in session: TimeSlot/StartTime of 1 means "see this week's agenda PDF". */
function vtStandingPlaceholder(row: VtMeeting): boolean {
  return String(row.TimeSlot) === "1" && String(row.StartTime) === "1";
}

const VT_DAY_RE =
  /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/gi;

function vtFirstCommitteeTime(text: string): string {
  const plain = stripTags(text.replace(/<br\s*\/?>/gi, "\n"));
  const re = /(\d{1,2}:\d{2}\s*[AP]M)\s+([^0-9]{2,120}?)(?=\d{1,2}:\d{2}\s*[AP]M|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(plain))) {
    const label = m[2].replace(/\s+/g, " ").trim();
    if (/^(house floor|senate floor|lunch|break|adjourn|recess|caucus|after floor)\b/i.test(label)) continue;
    return clockTime(m[1]);
  }
  return "";
}

function parseVtPublishedAgenda(raw: string, committeeTitle: string, pageUrl: string, year: number): CalendarEvent[] {
  const title = cleanOfficialTitle(committeeTitle);
  if (!title || junkOfficialTitle(title) || /not yet been published/i.test(raw)) return [];
  const chamber = chamberFromTitle(title, /^senate\b/i.test(title) ? "senate" : /^house\b/i.test(title) ? "house" : "joint");
  const days: { label: string; index: number }[] = [];
  const weekdayRe = new RegExp(VT_DAY_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = weekdayRe.exec(raw))) days.push({ label: m[0], index: m.index });
  if (!days.length) {
    const namedRe =
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/gi;
    while ((m = namedRe.exec(raw))) {
      const before = raw.slice(Math.max(0, m.index - 24), m.index);
      if (/last updated/i.test(before)) continue;
      days.push({ label: m[0], index: m.index });
    }
  }
  const out: CalendarEvent[] = [];
  for (let i = 0; i < days.length; i++) {
    const parsed = parseHumanDate(days[i].label, year);
    if (!parsed) continue;
    const slice = raw.slice(days[i].index, days[i + 1]?.index ?? raw.length);
    const time = vtFirstCommitteeTime(slice);
    if (!time) continue;
    const start = toIso(parsed.y, parsed.m, parsed.d, time);
    out.push(
      ev({
        sourceId: hashId("VT", start, title),
        state: "VT",
        title,
        start,
        location: stripTags(slice.match(/Room\s+\d+|Small Hearing Room|Large Hearing Room|Zoom/i)?.[0] || ""),
        chamber,
        url: pageUrl,
      }),
    );
  }
  return out;
}

function parseVtWeeklyHtml(html: string, pageUrl: string): CalendarEvent[] {
  const content = html.match(/id="agendacontent"[\s\S]*?<\/td>/i)?.[0] || html;
  const year = Number(pageUrl.match(/\/(\d{4})/)?.[1] || new Date().getFullYear());
  const out: CalendarEvent[] = [];
  for (const block of content.split(/<hr\s*\/?>/i)) {
    const heading = cleanOfficialTitle(stripTags(block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || ""));
    if (!heading || /standing committee meetings/i.test(heading)) continue;
    out.push(...parseVtPublishedAgenda(block, heading, pageUrl, year));
  }
  return out;
}

async function fetchVtWeeklyAgendas(session: number): Promise<CalendarEvent[]> {
  const pageUrl = `https://legislature.vermont.gov/committee/weeklyAgendas/${session}`;
  const html = await fetchText(pageUrl, 20000, { Referer: `https://legislature.vermont.gov/committee/meetings/${session}` });
  const events = parseVtWeeklyHtml(html, pageUrl);
  const meetingsUrl = `https://legislature.vermont.gov/committee/meetings/${session}`;
  let meetingsHtml = "";
  try {
    meetingsHtml = await fetchText(meetingsUrl, 18000, { Referer: meetingsUrl });
  } catch {
    return events;
  }
  const byId = new Map(events.map((e) => [e.sourceId, e]));
  const rowRe =
    /<tr[^>]*>\s*<td class="text-center">([\s\S]*?)<\/td>\s*<td>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const pdfs: { href: string; title: string }[] = [];
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(meetingsHtml))) {
    const agendaHref = row[1].match(/href="([^"]+)"/i)?.[1] || "";
    const title = cleanOfficialTitle(stripTags(row[3]));
    if (!agendaHref || !title) continue;
    const href = absUrl(meetingsUrl, agendaHref);
    if (/\.pdf($|\?)/i.test(href)) pdfs.push({ href, title });
    else if (/\/committee\/agenda\//i.test(href)) {
      try {
        const page = await fetchText(href, 15000, { Referer: meetingsUrl });
        for (const evRow of parseVtPublishedAgenda(page, title, href, session)) {
          if (!byId.has(evRow.sourceId)) byId.set(evRow.sourceId, evRow);
        }
      } catch {
        /* unpublished or blocked agenda page */
      }
    }
  }
  const extra = await mapPool(pdfs.slice(0, 16), 3, async (item) => {
    try {
      return parseVtPublishedAgenda(await fetchPdfText(item.href, 20000), item.title, item.href, session);
    } catch {
      return [] as CalendarEvent[];
    }
  });
  for (const list of extra) {
    for (const evRow of list) {
      if (!byId.has(evRow.sourceId)) byId.set(evRow.sourceId, evRow);
    }
  }
  return [...byId.values()];
}

function vtFloorStamp(url: string): { chamber: "house" | "senate"; y: number; m: number; d: number; addendum: boolean } | null {
  const m = url.match(/\/([hs])c(\d{2})(\d{2})(\d{2})(a)?\.pdf/i);
  if (!m) return null;
  return {
    chamber: m[1].toLowerCase() === "s" ? "senate" : "house",
    y: 2000 + Number(m[2]),
    m: Number(m[3]),
    d: Number(m[4]),
    addendum: Boolean(m[5]),
  };
}

function parseVtFloorPdf(
  text: string,
  pageUrl: string,
  chamber: "house" | "senate",
  stamp: { y: number; m: number; d: number },
): CalendarEvent | null {
  const convene = text.match(/convenes?\s+at\s+(\d{1,2}:\d{2}\s*[ap]\.?\s*m\.?)/i)?.[1] || "";
  const clock = clockTime(convene.replace(/\./g, " "));
  const title = chamber === "senate" ? "Senate Floor Session" : "House Floor Session";
  const start = toIso(stamp.y, stamp.m, stamp.d, clock);
  return ev({
    sourceId: hashId("VT", start, title),
    state: "VT",
    title,
    start,
    chamber,
    url: pageUrl,
  });
}

async function fetchVtFloorCalendars(session: number): Promise<CalendarEvent[]> {
  const pages = [
    { url: `https://legislature.vermont.gov/house/service/${session}/calendar`, chamber: "house" as const },
    { url: `https://legislature.vermont.gov/senate/service/${session}/calendar`, chamber: "senate" as const },
  ];
  const byId = new Map<string, CalendarEvent>();
  for (const page of pages) {
    let html = "";
    try {
      html = await fetchText(page.url, 18000);
    } catch {
      continue;
    }
    const seen = new Set<string>();
    const recent: Array<{ href: string; stamp: { y: number; m: number; d: number; chamber: "house" | "senate" } }> = [];
    for (const m of html.matchAll(/href="([^"]*Docs\/CALENDAR\/[hs]c\d{6}(?:a)?\.pdf[^"]*)"/gi)) {
      const href = absUrl(page.url, m[1]).split("?")[0];
      const stamp = vtFloorStamp(href);
      if (!stamp || stamp.addendum || seen.has(href)) continue;
      const day = vtDayKey(stamp);
      if (!vtDayInWindow(day)) continue;
      seen.add(href);
      recent.push({ href, stamp: { y: stamp.y, m: stamp.m, d: stamp.d, chamber: stamp.chamber } });
    }
    recent.sort((a, b) => vtDayKey(b.stamp).localeCompare(vtDayKey(a.stamp)));
    const pulled = await mapPool(recent.slice(0, 6), 2, async (item) => {
      try {
        return parseVtFloorPdf(await fetchPdfText(item.href, 20000), item.href, item.stamp.chamber, item.stamp);
      } catch {
        return null;
      }
    });
    for (const row of pulled) {
      if (row) byId.set(row.sourceId, row);
    }
  }
  return [...byId.values()];
}

async function fetchVtStandingCommitteeAgendas(session: number, placeholders: VtMeeting[]): Promise<CalendarEvent[]> {
  let rows: Array<{ PermanentID?: string; Type?: string; Inactive?: string; shortCommitteeName?: string; CommitteeName?: string }> = [];
  try {
    const payload = await fetchJson<{ data?: typeof rows }>(`https://legislature.vermont.gov/committee/loadList/${session}/`, 18000, {
      Referer: `https://legislature.vermont.gov/committee/list/${session}/House-Standing`,
    });
    rows = payload.data || [];
  } catch {
    return [];
  }
  const standing = rows.filter((r) => /Standing/i.test(r.Type || "") && String(r.Inactive) !== "1" && r.PermanentID);
  const byId = new Map(standing.map((r) => [String(r.PermanentID), r]));
  const window = upcomingWindow();
  const needed = new Map<string, string>();
  for (const row of placeholders) {
    if (!vtStandingPlaceholder(row)) continue;
    const parsed = parseHumanDate(row.MeetingDate || "") || vtFromUnix(row.StandardDate);
    if (!parsed) continue;
    const day = vtDayKey(parsed);
    if (day < window.from || day > window.to) continue;
    const id = String(row.PermanentID || "");
    const listed = id ? byId.get(id) : standing.find((r) => {
      const name = (r.shortCommitteeName || r.CommitteeName || "").toLowerCase();
      const want = (row.LongName || row.CommName || "").toLowerCase();
      return name && want && (name === want || want.includes(name) || name.includes(want));
    });
    const permanentId = String(listed?.PermanentID || id || "");
    if (!permanentId) continue;
    needed.set(permanentId, listed?.shortCommitteeName || listed?.CommitteeName || row.LongName || row.CommName || "");
  }
  if (!needed.size) return [];
  const pages = await mapPool([...needed.entries()], 4, async ([id, title]) => {
    const pageUrl = `https://legislature.vermont.gov/committee/detail/${session}/${id}`;
    try {
      const html = await fetchText(pageUrl, 15000, { Referer: `https://legislature.vermont.gov/committee/list/${session}/House-Standing` });
      const hrefs = [
        ...[...html.matchAll(/href="([^"]+\.pdf[^"]*)"/gi)].map((m) => absUrl(pageUrl, m[1])),
        ...[...html.matchAll(/href="([^"]*\/committee\/agenda\/[^"]+)"/gi)].map((m) => absUrl(pageUrl, m[1])),
      ].filter((u, i, all) => all.indexOf(u) === i && /weekly|\/agenda/i.test(u) && !/witness/i.test(u));
      const out: CalendarEvent[] = [];
      for (const href of hrefs.slice(0, 3)) {
        try {
          const raw = /\.pdf($|\?)/i.test(href) ? await fetchPdfText(href, 15000) : await fetchText(href, 12000);
          out.push(...parseVtPublishedAgenda(raw, title, href, session));
        } catch {
          /* unpublished weekly pdf */
        }
      }
      return out;
    } catch {
      return [] as CalendarEvent[];
    }
  });
  return pages.flat();
}

async function enrichVtMeetingAgendas(rows: VtMeeting[], session: number): Promise<CalendarEvent[]> {
  const window = upcomingWindow();
  const upcoming = rows.filter((row) => {
    if (!row.CommitteeMeetingID || vtStandingPlaceholder(row)) return false;
    const parsed = parseHumanDate(row.MeetingDate || "") || vtFromUnix(row.StandardDate);
    if (!parsed) return false;
    const day = vtDayKey(parsed);
    return day >= window.from && day <= window.to;
  }).slice(0, 24);
  const pages = await mapPool(upcoming, 4, async (row) => {
    const href = `https://legislature.vermont.gov/committee/agenda/${session}/${row.CommitteeMeetingID}`;
    const title = row.LongName || row.CommName || "";
    try {
      const html = await fetchText(href, 12000, { Referer: `https://legislature.vermont.gov/committee/meetings/${session}` });
      if (/not yet been published/i.test(html)) return [] as CalendarEvent[];
      const out = parseVtPublishedAgenda(html, title, href, session);
      const pdfs = [...html.matchAll(/href="([^"]+\.pdf[^"]*)"/gi)]
        .map((m) => absUrl(href, m[1]))
        .filter((u) => /agenda|weekly|calendar/i.test(u))
        .slice(0, 2);
      for (const pdf of pdfs) {
        try {
          out.push(...parseVtPublishedAgenda(await fetchPdfText(pdf, 15000), title, pdf, session));
        } catch {
          /* agenda html is enough */
        }
      }
      return out;
    } catch {
      return [] as CalendarEvent[];
    }
  });
  return pages.flat();
}

function vtFromUnix(raw?: string): { y: number; m: number; d: number } | null {
  const n = Number(raw || 0);
  if (!n) return null;
  const d = new Date(n * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

function parseVtHtml(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const year = Number(pageUrl.match(/\/(\d{4})/)?.[1] || new Date().getFullYear());
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html))) {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripTags(c[1]));
    if (cells.length < 3) continue;
    const parsed = parseHumanDate(cells.join(" ")) || parseHumanDate(cells[0] || "");
    const title = cleanOfficialTitle(cells.find((c) => /committee|house|senate|joint|oversight|study/i.test(c) && !parseHumanDate(c)) || "");
    if (!parsed || !title || junkOfficialTitle(title)) continue;
    const time = clockTime(cells.find((c) => /\d{1,2}:\d{2}\s*[ap]m/i.test(c)) || "");
    const start = toIso(parsed.y || year, parsed.m, parsed.d, time);
    const id = hashId("VT", start, title);
    if (byId.has(id)) continue;
    const agenda = row[1].match(/href="([^"]*agenda[^"]*)"/i)?.[1];
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "VT",
        title,
        start,
        chamber: chamberFromTitle(title, "joint"),
        url: agenda ? absUrl(pageUrl, agenda) : pageUrl,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

export async function fetchVtMeetings(): Promise<CalendarEvent[]> {
  const year = new Date().getFullYear();
  const years = [...new Set([year, 2026])];
  const byId = new Map<string, CalendarEvent>();
  const add = (rows: CalendarEvent[]) => {
    for (const e of rows.filter(usable)) {
      if (e.sourceId && !byId.has(e.sourceId)) byId.set(e.sourceId, e);
    }
  };
  for (const session of years) {
    const referer = { Referer: `https://legislature.vermont.gov/committee/meetings/${session}` };
    const jsonRows: VtMeeting[] = [];
    for (const path of ["loadAllMeetings", "loadStudyMeetings"]) {
      try {
        const payload = await fetchJson<{ data?: VtMeeting[] }>(
          `https://legislature.vermont.gov/committee/${path}/${session}`,
          18000,
          referer,
        );
        for (const row of payload.data || []) {
          jsonRows.push(row);
          if (vtStandingPlaceholder(row)) continue;
          const title = cleanOfficialTitle(row.LongName || row.CommName || "");
          const parsed = parseHumanDate(row.MeetingDate || "") || vtFromUnix(row.StandardDate);
          if (!title || !parsed || junkOfficialTitle(title)) continue;
          const start = toIso(parsed.y, parsed.m, parsed.d, vtClock(row.StartTime) || vtClock(row.TimeSlot));
          const id = row.CommitteeMeetingID ? `vt-${row.CommitteeMeetingID}` : hashId("VT", start, title);
          if (byId.has(id)) continue;
          const kind = (row.CommitteeType || "").toLowerCase();
          byId.set(
            id,
            ev({
              sourceId: id,
              state: "VT",
              title,
              start,
              location: [row.BuildingName, row.Room].filter(Boolean).join(" "),
              chamber: kind.includes("senate") ? "senate" : kind.includes("house") ? "house" : "joint",
              url: row.CommitteeMeetingID
                ? `https://legislature.vermont.gov/committee/agenda/${session}/${row.CommitteeMeetingID}`
                : `https://legislature.vermont.gov/committee/meetings/${session}#leg-committees`,
            }),
          );
        }
      } catch {
        /* one endpoint can fail */
      }
    }
    try {
      add(parseVtHtml(await fetchText(`https://legislature.vermont.gov/committee/meetings/${session}`, 18000, referer), `https://legislature.vermont.gov/committee/meetings/${session}`));
    } catch {
      /* HTML copy is a fallback */
    }
    try {
      add(await fetchVtFloorCalendars(session));
    } catch {
      /* floor PDFs only exist on session days */
    }
    try {
      add(await fetchVtWeeklyAgendas(session));
    } catch {
      /* weekly standing agendas are empty out of session */
    }
    try {
      add(await fetchVtStandingCommitteeAgendas(session, jsonRows));
    } catch {
      /* standing committee pages are extra */
    }
    try {
      add(await enrichVtMeetingAgendas(jsonRows, session));
    } catch {
      /* published agendas refine times when present */
    }
  }
  return collapseSameDayTitle([...byId.values()]);
}

const NM_HAPPENING = "https://www.nmlegis.gov/Calendar/Whats_Happening";
const NM_SESSION = "https://www.nmlegis.gov/Calendar/Session";
const NM_WEEKDAY =
  "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday";

type NmSessionLink = {
  href: string;
  label: string;
  chamber: "house" | "senate";
  kind: "floor" | "committees";
};

function nmPdfStamp(url: string): { chamber: "house" | "senate"; kind: "floor" | "committees"; y: number; m: number; d: number } | null {
  const m = url.match(/\/([hs])(Sched|Floor)(\d{2})(\d{2})(\d{2})\.pdf/i);
  if (!m) return null;
  return {
    chamber: m[1].toLowerCase() === "s" ? "senate" : "house",
    kind: /floor/i.test(m[2]) ? "floor" : "committees",
    m: Number(m[3]),
    d: Number(m[4]),
    y: 2000 + Number(m[5]),
  };
}

function parseNmSessionLinks(html: string, pageUrl: string): NmSessionLink[] {
  const blocks: Array<{ id: string; chamber: "house" | "senate"; kind: "floor" | "committees" }> = [
    { id: "MainContent_dataListHouseCalendarFloor", chamber: "house", kind: "floor" },
    { id: "MainContent_dataListHouseCalendarCommittees", chamber: "house", kind: "committees" },
    { id: "MainContent_dataListSenateCalendarFloor", chamber: "senate", kind: "floor" },
    { id: "MainContent_dataListSenateCalendarCommittees", chamber: "senate", kind: "committees" },
  ];
  const out: NmSessionLink[] = [];
  const seen = new Set<string>();
  const add = (href: string, label: string, chamber: "house" | "senate", kind: "floor" | "committees") => {
    const url = absUrl(pageUrl, href).split("#")[0];
    if (!url || seen.has(url)) return;
    if (/Entity\/(?:House|Senate)\/(?:Floor|Committee)_Calendar/i.test(url)) return;
    if (/no (floor calendar|committee schedule) found/i.test(label)) return;
    seen.add(url);
    out.push({ href: url, label, chamber, kind });
  };
  for (const block of blocks) {
    const table = html.match(new RegExp(`id="${block.id}"[\\s\\S]*?</table>`, "i"))?.[0] || "";
    for (const m of table.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      add(m[1], cleanOfficialTitle(stripTags(m[2])), block.chamber, block.kind);
    }
  }
  for (const m of html.matchAll(/href="([^"]*Agendas\/(?:Standing|Floor)\/[^"]+\.pdf[^"]*)"/gi)) {
    const href = m[1];
    const meta = nmPdfStamp(href);
    add(href, "", meta?.chamber || (/senate|sSched|sFloor/i.test(href) ? "senate" : "house"), meta?.kind || (/floor/i.test(href) ? "floor" : "committees"));
  }
  return out;
}

function nmSessionTitle(chamber: "house" | "senate", kind: "floor" | "committees"): string {
  if (kind === "floor") return chamber === "senate" ? "Senate Floor Session" : "House Floor Session";
  return chamber === "senate" ? "Senate Committee Schedule" : "House Committee Schedule";
}

function nmEventFromLink(item: NmSessionLink): CalendarEvent | null {
  const stamp = nmPdfStamp(item.href);
  const parsed = stamp || parseHumanDate(item.label);
  if (!parsed) return null;
  const chamber = stamp?.chamber || item.chamber;
  const kind = stamp?.kind || item.kind;
  const start = toIso(parsed.y, parsed.m, parsed.d);
  const title = item.label && !/\.pdf$/i.test(item.label) ? item.label : nmSessionTitle(chamber, kind);
  if (junkOfficialTitle(title)) return null;
  return ev({
    sourceId: hashId("NM", start, title),
    state: "NM",
    title,
    start,
    chamber,
    url: item.href,
  });
}

function parseNmCommitteePdf(text: string, pageUrl: string, chamber: "house" | "senate"): CalendarEvent[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const dayRe = new RegExp(
    `^(?:${NM_WEEKDAY}),\\s+([A-Za-z]+\\s+\\d{1,2},\\s+\\d{4})\\s+-\\s+(\\d{1,2}:\\d{2}\\s*[AP]M)\\s+-\\s+(.+)$`,
    "i",
  );
  let committee = "";
  const byId = new Map<string, CalendarEvent>();
  for (const line of lines) {
    const named = line.match(/^(HOUSE|SENATE)\s+(.+?)\s+COMMITTEE\b/i);
    if (named) {
      committee = cleanOfficialTitle(`${named[1]} ${named[2]} Committee`);
      continue;
    }
    const when = line.match(dayRe);
    if (!when || !committee) continue;
    const parsed = parseHumanDate(when[1]);
    if (!parsed) continue;
    const start = toIso(parsed.y, parsed.m, parsed.d, when[2]);
    const id = hashId("NM", start, committee);
    if (byId.has(id)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "NM",
        title: committee,
        start,
        location: when[3].replace(/\s+/g, " ").trim(),
        chamber,
        url: pageUrl,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

function parseNmFloorPdf(text: string, pageUrl: string, chamber: "house" | "senate"): CalendarEvent | null {
  const stamp = nmPdfStamp(pageUrl);
  const convene = text.match(/convenes?\s+at\s+(\d{1,2}:\d{2}\s*[ap]\.?\s*m\.?)/i)?.[1];
  const clock = convene ? convene.replace(/\./g, "").replace(/\s+/g, " ").trim() : "";
  const parsed =
    stamp ||
    parseHumanDate(text.match(new RegExp(`(?:${NM_WEEKDAY}),\\s+[A-Za-z]+\\s+\\d{1,2},\\s+\\d{4}`, "i"))?.[0] || "");
  if (!parsed) return null;
  const title = nmSessionTitle(chamber, "floor");
  const start = toIso(parsed.y, parsed.m, parsed.d, clock);
  return ev({
    sourceId: hashId("NM", start, title),
    state: "NM",
    title,
    start,
    chamber,
    url: pageUrl,
  });
}

function parseNm(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const re =
    /linkTitle_\d+"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,400}?lblDate_\d+"[^>]*>([\s\S]*?)<\/span>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const title = cleanOfficialTitle(stripTags(m[2]));
    const parsed = parseHumanDate(stripTags(m[3]));
    if (!title || !parsed || junkOfficialTitle(title)) continue;
    const start = toIso(parsed.y, parsed.m, parsed.d);
    const id = hashId("NM", start, title);
    if (byId.has(id)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "NM",
        title,
        start,
        url: absUrl(pageUrl, m[1]),
      }),
    );
  }
  if (/dataListHouseCalendarFloor|Upcoming Session Calendar/i.test(html)) {
    for (const item of parseNmSessionLinks(html, pageUrl)) {
      const row = nmEventFromLink(item);
      if (row && !byId.has(row.sourceId)) byId.set(row.sourceId, row);
    }
  }
  return [...byId.values()].filter(usable);
}

async function fetchNmSessionPdfs(html: string): Promise<CalendarEvent[]> {
  const window = upcomingWindow();
  const inWindow = (start: string) => {
    const day = start.slice(0, 10);
    return day >= window.from && day <= window.to;
  };
  const items = parseNmSessionLinks(html, NM_SESSION).filter((item) => /\.pdf($|\?)/i.test(item.href));
  items.sort((a, b) => {
    const da = nmPdfStamp(a.href);
    const db = nmPdfStamp(b.href);
    const ka = da ? `${da.y}-${String(da.m).padStart(2, "0")}-${String(da.d).padStart(2, "0")}` : "";
    const kb = db ? `${db.y}-${String(db.m).padStart(2, "0")}-${String(db.d).padStart(2, "0")}` : "";
    return kb.localeCompare(ka);
  });
  const picked = items.slice(0, 16);
  const parts = await mapPool(picked, 3, async (item) => {
    const url = item.href;
    try {
      if (item.kind === "committees") {
        const rows = parseNmCommitteePdf(await fetchPdfText(url), url, item.chamber).filter((e) => inWindow(e.start));
        if (rows.length) return rows;
      } else {
        const floor = parseNmFloorPdf(await fetchPdfText(url), url, item.chamber);
        if (floor && inWindow(floor.start)) return [floor];
      }
    } catch {
      /* dated filename is enough when the PDF cannot be read */
    }
    const fallback = nmEventFromLink(item);
    return fallback && inWindow(fallback.start) ? [fallback] : [];
  });
  return parts.flat();
}

export async function fetchNmMeetings(): Promise<CalendarEvent[]> {
  const happening = parseNm(await fetchText(NM_HAPPENING), NM_HAPPENING);
  let sessionHtml = "";
  try {
    sessionHtml = await fetchText(NM_SESSION);
  } catch {
    return happening;
  }
  const detailed = await fetchNmSessionPdfs(sessionHtml);
  const listed = detailed.length ? [] : parseNm(sessionHtml, NM_SESSION);
  return collapseSameDayTitle([...happening, ...detailed, ...listed]);
}

const AK_MEETINGS = "https://www.akleg.gov/basis/Meeting/";
const AK_CATEGORY = /^(standing|special|joint|conference|other|finance sub)(\s+committees?)?$/i;

function mdY(isoDay: string): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  return `${m}/${d}/${y}`;
}

function akCommitteeTitle(chamber: "house" | "senate", rawName: string, kind: string): string {
  const label = chamber === "senate" ? "Senate" : "House";
  let name = stripTags(rawName).replace(/\s+/g, " ").replace(/\*+$/, "").trim();
  const kindText = stripTags(kind).replace(/\s+/g, " ").trim();
  if (AK_CATEGORY.test(name) && !AK_CATEGORY.test(kindText.split(/\s+/).slice(0, 3).join(" "))) {
    name = kindText.replace(/\s+(standing|special|joint|conference)?\s*committees?$/i, "").trim();
  }
  if (!name || AK_CATEGORY.test(name)) return "";
  const pretty = cleanOfficialTitle(name);
  if (!pretty) return "";
  if (/council|commission|task force|subcommittee/i.test(pretty) || /\bcommittee\b/i.test(pretty)) {
    return `${label} ${pretty}`;
  }
  return `${label} ${pretty} Committee`;
}

function parseAk(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const blocks = html.split(/<tr><td colspan="8"><hr>/i);
  for (const block of blocks) {
    const head = block.match(
      /<td[^>]*>\s*\(([HS])\)\s*([^<]+?)\s*<\/td>\s*<td[^>]*>\s*([^<]*)/i,
    );
    if (!head) continue;
    const chamber = head[1].toUpperCase() === "S" ? "senate" : "house";
    const title = akCommitteeTitle(chamber, head[2], head[3]);
    if (!title || junkOfficialTitle(title)) continue;
    const when = block.match(
      /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2})\s+[A-Za-z]+\s+(\d{1,2}:\d{2}\s*[AP]M)/i,
    );
    if (!when) continue;
    const parsed = parseHumanDate(when[1]);
    if (!parsed) continue;
    const start = toIso(parsed.y, parsed.m, parsed.d, when[2]);
    const code = (block.match(/Committee\/Details\/\?code=([A-Z0-9]+)/i)?.[1] || "").toUpperCase();
    const loc =
      block.match(
        /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\s+[A-Za-z]+\s+\d{1,2}:\d{2}\s*[AP]M<\/td>\s*<td[^>]*>([^<]*)/i,
      )?.[1] || "";
    const id = code ? `AK|${code}|${start}` : hashId("AK", start, title);
    if (byId.has(id)) continue;
    const meeting = code
      ? `https://www.akleg.gov/basis/Meeting/Detail?Meeting=${encodeURIComponent(
          `${code} ${start.slice(0, 10)} ${start.slice(11, 16)}:00`,
        )}`
      : pageUrl;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "AK",
        title,
        start,
        location: stripTags(loc),
        chamber,
        url: meeting,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

export async function fetchAkMeetings(): Promise<CalendarEvent[]> {
  const { from, to } = upcomingWindow();
  const rangeUrl = `${AK_MEETINGS}Index?mode=results&type=All&com=&startDate=${encodeURIComponent(mdY(from))}&endDate=${encodeURIComponent(mdY(to))}&chamber=`;
  const byId = new Map<string, CalendarEvent>();
  for (const [url, headers] of [
    [rangeUrl, { "X-Requested-With": "XMLHttpRequest", Referer: AK_MEETINGS }],
    [AK_MEETINGS, undefined],
  ] as Array<[string, Record<string, string> | undefined]>) {
    try {
      const html = await fetchText(url, 18000, headers);
      for (const row of parseAk(html, AK_MEETINGS)) {
        if (!byId.has(row.sourceId)) byId.set(row.sourceId, row);
      }
    } catch {
      /* try the next source */
    }
  }
  return [...byId.values()];
}

function parseMs(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  for (const row of [...parseMsHtml(html, pageUrl), ...parseMsPre(html, pageUrl)]) {
    if (!byId.has(row.sourceId)) byId.set(row.sourceId, row);
  }
  return [...byId.values()].filter(usable);
}

function parseMsHtml(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const house = /h_sched/i.test(pageUrl);
  const parts = html.split(/<p class="fw-bold">/i);
  for (const part of parts.slice(1)) {
    const headingEnd = part.search(/<\/p>/i);
    if (headingEnd < 0) continue;
    const parsed = parseHumanDate(stripTags(part.slice(0, headingEnd)));
    if (!parsed) continue;
    const body = part.slice(headingEnd);
    const blocks = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((c) => stripTags(c[1]));
    let time = "";
    let room = "";
    for (const cell of blocks) {
      if (/^time$|^room$/i.test(cell) || !cell) continue;
      if (/^\d{1,2}:\d{2}\s*[ap]m$/i.test(cell)) {
        time = cell;
        continue;
      }
      if (/^\d{2,4}[A-Z\-]?$/i.test(cell) || /^\d+[A-Z]$/i.test(cell) || /^[A-Z]?\d{2,4}[A-Z\-]*$/i.test(cell)) {
        room = cell;
        continue;
      }
      const title = cleanOfficialTitle(cell);
      if (!title || junkOfficialTitle(title) || title.length < 4) continue;
      const start = toIso(parsed.y, parsed.m, parsed.d, time);
      const id = hashId("MS", start, title);
      if (byId.has(id)) continue;
      byId.set(
        id,
        ev({
          sourceId: id,
          state: "MS",
          title,
          start,
          location: room ? `Room ${room}` : "",
          chamber: house ? "house" : /senate/i.test(pageUrl) ? "senate" : "",
          url: pageUrl,
        }),
      );
    }
  }
  return [...byId.values()].filter(usable);
}

function parseMsPre(html: string, pageUrl: string): CalendarEvent[] {
  const pre = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)?.[1];
  if (!pre) return [];
  const text = decodeEntities(pre.replace(/\r/g, ""));
  const house = /h_sched/i.test(pageUrl);
  const byId = new Map<string, CalendarEvent>();
  const lines = text.split("\n");
  let parsed: { y: number; m: number; d: number } | null = null;
  let pending: { time: string; loc: string; title: string } | null = null;

  const flush = () => {
    if (!pending || !parsed) return;
    const title = cleanOfficialTitle(pending.title.replace(/\s+/g, " ").trim());
    if (!title || junkOfficialTitle(title) || /^reserved for\b/i.test(title) || /will not meet|^legend:/i.test(title)) {
      pending = null;
      return;
    }
    const clock = pending.time.replace(/([AP])$/i, " $1M");
    const start = toIso(parsed.y, parsed.m, parsed.d, clock);
    const id = hashId("MS", start, title);
    if (!byId.has(id)) {
      const t = title.toLowerCase();
      const loc = pending.loc;
      byId.set(
        id,
        ev({
          sourceId: id,
          state: "MS",
          title,
          start,
          location: /^\d+[A-Z]?$/i.test(loc) ? `Room ${loc}` : loc,
          chamber: /\bjoint\b/.test(t) ? "joint" : house ? "house" : "senate",
          url: pageUrl,
        }),
      );
    }
    pending = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\u00a0/g, " ");
    const day = line.match(
      /^\s*(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY),\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\s*$/i,
    );
    if (day) {
      flush();
      parsed = parseHumanDate(day[2]);
      continue;
    }
    if (/^_{8,}|^\s*LEGEND:/i.test(line)) {
      flush();
      continue;
    }
    const row = line.match(
      /^\s*(\d{1,2}:\d{2}[AP])\s+(\d+[A-Z]?|[A-Za-z][A-Za-z .'-]*,\s*[A-Z]{2})\s{2,}(.+?)\s*$/i,
    );
    if (row) {
      flush();
      pending = { time: row[1], loc: row[2].trim(), title: row[3].trim() };
      continue;
    }
    if (pending && /^\s{10,}\S/.test(line)) {
      pending.title += ` ${line.trim()}`;
    }
  }
  flush();
  return [...byId.values()].filter(usable);
}

export async function fetchMsSchedule(): Promise<CalendarEvent[]> {
  const byId = new Map<string, CalendarEvent>();
  const errors: string[] = [];
  for (const url of [
    "https://billstatus.ls.state.ms.us/htms/h_sched.htm",
    "https://billstatus.ls.state.ms.us/htms/s_sched.htm",
  ]) {
    try {
      for (const row of parseMs(await fetchText(url, 20000), url)) byId.set(row.sourceId, row);
    } catch (err) {
      errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!byId.size && errors.length) throw new Error(errors.join("; "));
  return [...byId.values()];
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseAr(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const headers = [...html.matchAll(/class="row tableSectionHeader"[\s\S]{0,400}?([A-Z][a-z]+,\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4})/g)].map(
    (h) => ({ index: h.index || 0, date: h[1] }),
  );
  const rowRe =
    /class="row tableRow(?:Alt)?"[\s\S]{0,800}?<b>\s*(\d{1,2}:\d{2}\s*[AP]M)[\s\S]{0,400}?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const header = headers.filter((h) => h.index < (m?.index || 0)).at(-1);
    const parsed = parseHumanDate(header?.date || "");
    const title = cleanOfficialTitle(stripTags(m[3]));
    if (!parsed || !title || junkOfficialTitle(title)) continue;
    const start = toIso(parsed.y, parsed.m, parsed.d, m[1]);
    const id = hashId("AR", start, title);
    if (byId.has(id)) continue;
    const t = title.toLowerCase();
    const loc = stripTags(html.slice(m.index, m.index + 900)).match(/\bRoom\s+[A-Z0-9][A-Z0-9\-]*/i)?.[0] || "";
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "AR",
        title,
        start,
        location: loc,
        chamber: /\bsenate and house\b|\bhouse and senate\b|\bjoint\b|\balc\b/.test(t)
          ? "joint"
          : /\bsenate\b/.test(t)
            ? "senate"
            : /\bhouse\b/.test(t)
              ? "house"
              : "",
        url: absUrl(pageUrl, m[2]),
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

export async function fetchArMeetings(): Promise<CalendarEvent[]> {
  const from = new Date();
  from.setDate(from.getDate() - 7);
  const to = new Date();
  to.setDate(to.getDate() + 75);
  const urls = [
    `https://www.arkleg.state.ar.us/Calendars/Meetings?meetingStartDate=${isoDay(from)}&meetingEndDate=${isoDay(to)}`,
    "https://www.arkleg.state.ar.us/Calendars/Meetings?listview=month",
  ];
  const byId = new Map<string, CalendarEvent>();
  for (const url of urls) {
    try {
      for (const row of parseAr(await fetchText(url), url)) {
        if (!byId.has(row.sourceId)) byId.set(row.sourceId, row);
      }
    } catch {
      /* one view can fail */
    }
  }
  return [...byId.values()].filter(usable);
}

type NhWsEvent = { title?: string; start?: string; url?: string };

async function fetchNhChamber(url: string, chamber: string): Promise<CalendarEvent[]> {
  const payload = await fetchJson<{ d?: string } | NhWsEvent[]>(url, 18000, {
    "Content-Type": "application/json; charset=utf-8",
  });
  const rows: NhWsEvent[] = Array.isArray(payload)
    ? payload
    : JSON.parse(typeof payload.d === "string" ? payload.d : "[]");
  return rows
    .map((row) => {
      const title = cleanOfficialTitle((row.title || "").split(":")[0] || row.title || "");
      const start = row.start || "";
      const loc = (row.title || "").includes(":") ? row.title!.slice(row.title!.indexOf(":") + 1).trim() : "";
      return ev({
        sourceId: hashId("NH", start, title),
        state: "NH",
        title,
        start,
        location: loc.replace(/\s+/g, " ").slice(0, 120),
        chamber,
        url: row.url ? absUrl(url, row.url) : url,
      });
    })
    .filter((e) => e.start && usable(e));
}

export async function fetchNhEvents(): Promise<CalendarEvent[]> {
  const byId = new Map<string, CalendarEvent>();
  const feeds: [string, string][] = [
    ["house", "https://gc.nh.gov/house/schedule/CalendarWS.asmx/GetEvents"],
    ["senate", "https://gc.nh.gov/senate/schedule/CalendarWS.asmx/GetEvents"],
  ];
  for (const [chamber, url] of feeds) {
    try {
      for (const row of await fetchNhChamber(url, chamber)) byId.set(row.sourceId, row);
    } catch {
      /* one chamber can fail */
    }
  }
  return [...byId.values()];
}

function parseNyHearings(html: string, pageUrl: string): CalendarEvent[] {
  const yearMatch = stripTags(html.match(/hdr-date[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "").match(/(\d{4})/);
  const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();
  const byId = new Map<string, CalendarEvent>();
  const blocks = html.split(/<ul class="hrg-info-list"/i).slice(1);
  for (const block of blocks) {
    const dateRaw = stripTags(block.match(/hrg-date[\s\S]*?<span>([\s\S]*?)<\/span>/i)?.[1] || "");
    const parsed = parseHumanDate(`${dateRaw} ${year}`) || parseHumanDate(dateRaw);
    const comms = [...block.matchAll(/comm-txt[^>]*>([\s\S]*?)<\/div>/gi)].map((c) => stripTags(c[1])).filter(Boolean);
    const comm = comms.find((c) => !/\$/.test(c)) || comms[0] || "";
    const hearing = stripTags(
      block.match(/hrg-txt cal-text[^>]*>([\s\S]*?)(?:<div class="hrg-link"|<\/div>)/i)?.[1] || "",
    );
    const title = cleanOfficialTitle(comm || hearing);
    if (!parsed || !title || junkOfficialTitle(title)) continue;
    const time = stripTags(block.match(/time-txt[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "");
    const loc = stripTags(block.match(/loca-txt[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "");
    const href = block.match(/href="([^"]*comm\/\?id=[^"]+)"/i)?.[1];
    const start = toIso(parsed.y, parsed.m, parsed.d, time.replace(/\./g, ""));
    const id = hashId("NY", start, title);
    if (byId.has(id)) continue;
    const blob = `${comm} ${loc}`.toLowerCase();
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "NY",
        title: hearing && comm ? `${comm}: ${cleanOfficialTitle(hearing)}`.slice(0, 140) : title,
        start,
        location: loc.replace(/\s+/g, " "),
        chamber: /\bsenate\b/.test(blob) && !/\bassembly\b/.test(blob) ? "senate" : /\bjoint\b/.test(blob) ? "joint" : "house",
        url: href ? absUrl(pageUrl, href) : pageUrl,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

export async function fetchNyHearings(): Promise<CalendarEvent[]> {
  const byId = new Map<string, CalendarEvent>();
  const add = (rows: CalendarEvent[]) => {
    for (const row of rows) {
      if (!byId.has(row.sourceId)) byId.set(row.sourceId, row);
    }
  };
  try {
    const url = "https://www.nyassembly.gov/leg/?sh=hear";
    add(parseNyHearings(await fetchText(url), url));
  } catch {
    /* assembly page can fail */
  }
  try {
    const url = "https://www.nysenate.gov/events";
    const html = await fetchText(url, 15000);
    if (!/just a moment|cf-browser-verification|challenge-platform/i.test(html)) {
      add(parseNySenateEvents(html, url));
    }
  } catch {
    /* senate events are often Cloudflare-blocked */
  }
  return [...byId.values()];
}

function parseNySenateEvents(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const cards = html.split(/<article\b/i).slice(1);
  for (const card of cards) {
    if (/c-block--initiative|promotional-banner/i.test(card)) continue;
    const datetime = card.match(/<time[^>]*datetime="([^"]+)"/i)?.[1];
    if (!datetime) continue;
    const title = cleanOfficialTitle(
      stripTags(card.match(/<(?:h[1-3]|a)[^>]*>([\s\S]*?)<\/(?:h[1-3]|a)>/i)?.[1] || ""),
    );
    const parsed = parseHumanDate(datetime) || parseHumanDate(stripTags(card.match(/<time[^>]*>([\s\S]*?)<\/time>/i)?.[1] || ""));
    if (!title || !parsed || junkOfficialTitle(title)) continue;
    const time = stripTags(card).match(/\d{1,2}:\d{2}\s*[ap]m/i)?.[0];
    const start = toIso(parsed.y, parsed.m, parsed.d, time);
    const href = card.match(/href="([^"]+)"/i)?.[1];
    const id = hashId("NY", start, title);
    if (byId.has(id)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "NY",
        title,
        start,
        chamber: "senate",
        url: href ? absUrl(pageUrl, href) : pageUrl,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

type AzAlisEvent = {
  id?: number;
  start?: string;
  title?: string;
  longtitle?: string;
  location?: string;
  cancelled?: number;
  type?: string;
  body?: string;
  PDFFile?: string;
  time?: string;
};

export async function fetchAzAlis(): Promise<CalendarEvent[]> {
  const from = new Date();
  from.setMonth(from.getMonth() - 8);
  const to = new Date();
  to.setDate(to.getDate() + 90);
  const byId = new Map<string, CalendarEvent>();
  for (const body of ["H", "S", "I"]) {
    const url = `https://www.azleg.gov/azlegwp/wp-content/themes/azleg/alistodayAgendaData.php?body=${body}&start=${isoDay(from)}&end=${isoDay(to)}`;
    try {
      const rows = await fetchJson<AzAlisEvent[]>(url);
      for (const row of rows || []) {
        if (row.cancelled) continue;
        const title = cleanOfficialTitle(row.longtitle || row.title || "");
        const start = (row.start || "").replace(" ", "T");
        if (!title || !start || junkOfficialTitle(title)) continue;
        const id = row.id ? `az-${row.id}` : hashId("AZ", start, title);
        if (byId.has(id)) continue;
        const chamber = body === "S" ? "senate" : body === "H" ? "house" : "joint";
        byId.set(
          id,
          ev({
            sourceId: id,
            state: "AZ",
            title,
            start,
            location: row.location || "",
            chamber,
            url: row.PDFFile
              ? absUrl("https://www.azleg.gov", row.PDFFile)
              : "https://www.azleg.gov/alis-today/",
          }),
        );
      }
    } catch {
      /* one body can fail */
    }
  }
  try {
    const pageUrl = "https://www.azleg.gov/interim-committee-agendas/";
    for (const row of parseAzInterims(await fetchText(pageUrl), pageUrl)) {
      if (!byId.has(row.sourceId)) byId.set(row.sourceId, row);
    }
  } catch {
    /* interim table is a bonus */
  }
  for (const row of await fetchAzLibCal()) {
    if (!byId.has(row.sourceId)) byId.set(row.sourceId, row);
  }
  return [...byId.values()].filter(usable);
}

const AZ_LIBCAL = [
  { cid: "17304", label: "Capitol Museum" },
  { cid: "17589", label: "Capitol Lawn" },
];

async function fetchAzLibCal(): Promise<CalendarEvent[]> {
  const byId = new Map<string, CalendarEvent>();
  for (const cal of AZ_LIBCAL) {
    try {
      const ics = parseIcsText(
        await fetchText(`https://azleg.libcal.com/ical_subscribe.php?src=p&cid=${cal.cid}`, 20000),
      );
      for (const row of ics) {
        const title = cleanOfficialTitle(row.title);
        if (!title || junkOfficialTitle(title)) continue;
        const start = row.start;
        const id = hashId("AZ", start, title);
        if (byId.has(id)) continue;
        byId.set(
          id,
          ev({
            sourceId: id,
            state: "AZ",
            title,
            start,
            location: row.location || cal.label,
            chamber: "joint",
            url: row.url || `https://azleg.libcal.com/calendar?cid=${cal.cid}`,
            description: row.description || cal.label,
          }),
        );
      }
    } catch {
      /* one LibCal feed can fail */
    }
  }
  return [...byId.values()].filter(usable);
}

function parseAzInterims(html: string, pageUrl: string): CalendarEvent[] {
  const table = html.match(/id="CommitteeAgenda"[\s\S]*?<\/table>/i)?.[0] || "";
  const byId = new Map<string, CalendarEvent>();
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(table))) {
    if (/<th/i.test(row[1])) continue;
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    if (cells.length < 7) continue;
    if (/Cancelled/i.test(stripTags(cells[3] || "")) || /cancelled/i.test(stripTags(cells[4] || ""))) continue;
    const dateText = stripTags(cells[0] || "").replace(/\s+/g, "");
    const dm = dateText.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (!dm) continue;
    const title = cleanOfficialTitle(stripTags(cells[1] || ""));
    if (!title || junkOfficialTitle(title)) continue;
    const time = clockTime(stripTags(cells[4] || ""));
    const start = toIso(Number(dm[3]), Number(dm[1]), Number(dm[2]), time);
    const href = cells[6]?.match(/href="?([^"'\s>]+)/i)?.[1];
    const id = hashId("AZ", start, title);
    if (byId.has(id)) continue;
    const t = title.toLowerCase();
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "AZ",
        title,
        start,
        location: stripTags(cells[5] || ""),
        chamber: /\bjoint\b/.test(t) ? "joint" : /\bsenate\b/.test(t) ? "senate" : /\bhouse\b/.test(t) ? "house" : "joint",
        url: href ? absUrl(pageUrl, href) : pageUrl,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

type IlHearing = {
  scheduledDateTime?: string;
  ScheduledDateTime?: string;
  longDescription?: string;
  LongDescription?: string;
  textLine?: string;
  TextLine?: string;
  room?: string;
  Room?: string;
  building?: string;
  Building?: string;
  committeeID?: number | string;
  CommitteeID?: number | string;
  hearingID?: number | string;
  HearingID?: number | string;
};

function ilMdY(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

export async function fetchIlHearings(): Promise<CalendarEvent[]> {
  const from = new Date();
  from.setMonth(from.getMonth() - 8);
  const to = new Date();
  to.setDate(to.getDate() + 90);
  const byId = new Map<string, CalendarEvent>();
  for (const chamber of [
    { id: "h", name: "House", chamber: "house" },
    { id: "s", name: "Senate", chamber: "senate" },
  ]) {
    const url = `https://www.ilga.gov/API/Hearings/GetHearingsListByRange?ChamberId=${chamber.id}&GaId=18&BeginDate=${encodeURIComponent(ilMdY(from))}&EndDate=${encodeURIComponent(ilMdY(to))}`;
    try {
      const rows = await fetchJson<IlHearing[]>(url);
      for (const row of rows || []) {
        const scheduled = row.scheduledDateTime || row.ScheduledDateTime || "";
        const title = cleanOfficialTitle(row.longDescription || row.LongDescription || "");
        const parsed = parseHumanDate(scheduled);
        if (!title || !parsed || junkOfficialTitle(title)) continue;
        const time = scheduled.match(/\d{1,2}:\d{2}\s*[ap]m/i)?.[0];
        const start = toIso(parsed.y, parsed.m, parsed.d, time);
        const committeeId = row.committeeID ?? row.CommitteeID;
        const hearingId = row.hearingID ?? row.HearingID;
        const id = hearingId ? `il-${hearingId}` : hashId("IL", start, title);
        if (byId.has(id)) continue;
        const loc = [row.room || row.Room, row.building || row.Building].filter(Boolean).join(" ");
        byId.set(
          id,
          ev({
            sourceId: id,
            state: "IL",
            title,
            start,
            location: loc,
            chamber: chamber.chamber,
            url:
              committeeId && hearingId
                ? `https://ilga.gov/${chamber.name}/hearings/details/${committeeId}/${hearingId}`
                : `https://www.ilga.gov/${chamber.id === "s" ? "senate" : "house"}/schedules/`,
            description: row.textLine || row.TextLine || "",
          }),
        );
      }
    } catch {
      /* one chamber can fail */
    }
  }
  return [...byId.values()].filter(usable);
}

const OK_SENATE_MEETINGS = "https://oksenate.gov/committee-meetings";

function parseOkSenate(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const tiles = html.split(/class="[^"]*bTiles__item[^"]*"/i).slice(1);
  for (const tile of tiles) {
    const title = cleanOfficialTitle(
      stripTags(tile.match(/bTiles__title[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || ""),
    );
    const whenText = stripTags(tile.match(/<time[^>]*>([\s\S]*?)<\/time>/i)?.[1] || "");
    const parsed = parseHumanDate(whenText);
    if (!title || !parsed || junkOfficialTitle(title)) continue;
    const time = whenText.match(/\d{1,2}:\d{2}\s*[ap]m/i)?.[0];
    const start = toIso(parsed.y, parsed.m, parsed.d, time);
    const href = tile.match(/href="([^"]*meeting-notices[^"]*)"/i)?.[1];
    const loc = stripTags(tile.match(/bTiles__sub[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "")
      .split("•")
      .map((p) => p.trim())
      .filter((p) => p && !p.toLowerCase().includes(title.toLowerCase()))
      .join(" ");
    const id = hashId("OK", start, title);
    if (byId.has(id)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "OK",
        title,
        start,
        location: loc.slice(0, 120),
        chamber: "senate",
        url: href ? absUrl(pageUrl, href) : pageUrl,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

const OK_HOUSE_INTERIMS = "https://former.okhouse.gov/committees/ShowInterimStudies.aspx";

function parseOkHouseInterims(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const rowRe =
    /<td>([^<]{3,240})<\/td><td class="additionalColumnsp">[^<]*<\/td><td class="additionalColumnsp">([^<]+)<\/td><td class="additionalColumnsp">([^<]+)<\/td><td style="width:108px;">(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M)<\/td><td style="width:108px;">([^<]*)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const study = stripTags(m[1]);
    const committee = stripTags(m[2]);
    const status = stripTags(m[3]);
    if (/cancel|denied|withdrawn/i.test(status)) continue;
    const parsed = parseHumanDate(m[4]);
    const clock = m[4].match(/(\d{1,2}:\d{2})(?::\d{2})?\s*([AP]M)/i);
    const time = clock ? `${clock[1]} ${clock[2]}` : undefined;
    const title = cleanOfficialTitle(committee && study ? `${committee} — ${study}` : committee || study);
    if (!parsed || !title || junkOfficialTitle(title)) continue;
    const start = toIso(parsed.y, parsed.m, parsed.d, time);
    const id = hashId("OK", start, title);
    if (byId.has(id)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "OK",
        title,
        start,
        location: stripTags(m[5]).replace(/&nbsp;/g, "").trim(),
        chamber: "house",
        url: pageUrl,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

export async function fetchOkMeetings(): Promise<CalendarEvent[]> {
  const byId = new Map<string, CalendarEvent>();
  try {
    for (const row of parseOkSenate(await fetchText(OK_SENATE_MEETINGS), OK_SENATE_MEETINGS)) {
      byId.set(row.sourceId, row);
    }
  } catch {
    /* senate page can fail independently */
  }
  try {
    for (const row of parseOkHouseInterims(await fetchText(OK_HOUSE_INTERIMS, 25000), OK_HOUSE_INTERIMS)) {
      if (!byId.has(row.sourceId)) byId.set(row.sourceId, row);
    }
  } catch {
    /* house interims can fail independently */
  }
  return [...byId.values()].filter(usable);
}

function parseJsonLdEvents(html: string, state: string, pageUrl: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1]) as Record<string, unknown> | Record<string, unknown>[];
      const nodes = Array.isArray(data)
        ? data
        : data && typeof data === "object" && Array.isArray((data as { "@graph"?: unknown[] })["@graph"])
          ? ((data as { "@graph": Record<string, unknown>[] })["@graph"] as Record<string, unknown>[])
          : [data as Record<string, unknown>];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const type = String(node["@type"] || "");
        if (!/event/i.test(type)) continue;
        const start = String(node.startDate || "");
        const title = cleanOfficialTitle(String(node.name || node.headline || ""));
        if (!start || !title || junkOfficialTitle(title)) continue;
        const loc = node.location;
        events.push(
          ev({
            sourceId: hashId(state, start, title),
            state,
            title,
            start,
            location:
              typeof loc === "string"
                ? loc
                : loc && typeof loc === "object"
                  ? String((loc as { name?: string }).name || "")
                  : "",
            url: String(node.url || pageUrl),
          }),
        );
      }
    } catch {
      /* ignore invalid json-ld */
    }
  }
  return events.filter(usable);
}

export async function fetchIdCalendars(): Promise<CalendarEvent[]> {
  const byId = new Map<string, CalendarEvent>();
  const feeds: [string, string][] = [
    ["house", "https://legislature.idaho.gov/house/calendar/"],
    ["senate", "https://legislature.idaho.gov/senate/calendar/"],
  ];
  for (const [chamber, url] of feeds) {
    try {
      const rows = parseJsonLdEvents(await fetchText(url, 45000), "ID", url);
      for (const row of rows) {
        if (byId.has(row.sourceId)) continue;
        byId.set(row.sourceId, { ...row, chamber });
      }
    } catch {
      /* one chamber can time out */
    }
  }
  try {
    const rows = parseJsonLdEvents(
      await fetchText("https://legislature.idaho.gov/calendar/", 45000),
      "ID",
      "https://legislature.idaho.gov/calendar/",
    );
    for (const row of rows) {
      if (byId.has(row.sourceId)) continue;
      const t = row.title.toLowerCase();
      byId.set(row.sourceId, {
        ...row,
        chamber: /\bsenate\b/.test(t) ? "senate" : /\bhouse\b/.test(t) ? "house" : row.chamber || "",
      });
    }
  } catch {
    /* combined calendar can time out */
  }
  try {
    const icsUrl =
      "https://legislature.idaho.gov/?plugin=all-in-one-event-calendar&controller=ai1ec_exporter_controller&action=export_events&no_html=true&ai1ec_cat_ids=316,315,345";
    const { from, to } = upcomingWindow();
    for (const row of parseIcsText(await fetchText(icsUrl, 45000))) {
      const day = (row.start || "").slice(0, 10);
      if (day < from || day > to) continue;
      const title = cleanOfficialTitle(row.title);
      const id = row.sourceId ? `id-ics-${row.sourceId}`.slice(0, 180) : hashId("ID", row.start, title);
      if (byId.has(id)) continue;
      byId.set(
        id,
        ev({
          sourceId: id,
          state: "ID",
          title,
          start: row.start,
          location: row.location,
          chamber: chamberFromTitle(title),
          url: row.url || "https://legislature.idaho.gov/committee-calendar/",
          description: row.description,
        }),
      );
    }
  } catch {
    /* ICS export can time out */
  }
  return [...byId.values()].filter(usable);
}

function parseRssDate(text: string): { y: number; m: number; d: number } | null {
  const t = Date.parse(text);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

const NJ_PUB = "https://pub.njleg.state.nj.us/publications/legislative-calendar/";
const NJ_FALLBACK = `${NJ_PUB}082826.htm`;

function njStamp(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}${dd}${yy}`;
}

function njStampValue(stamp: string): number {
  const mm = Number(stamp.slice(0, 2));
  const dd = Number(stamp.slice(2, 4));
  const yy = Number(stamp.slice(4, 6));
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  return Date.UTC(year, mm - 1, dd);
}

async function tryNjHtml(url: string): Promise<string | null> {
  try {
    const html = await fetchText(url, 10000);
    if (html.length > 400 && /legislative calendar/i.test(html)) return html;
  } catch {
    /* 404 or blocked */
  }
  return null;
}

export async function fetchNjCalendar(): Promise<{ url: string; events: CalendarEvent[] }> {
  let landing = "";
  try {
    landing = await fetchText("https://www.njleg.state.nj.us/legislative-calendar", 10000);
  } catch {
    landing = "";
  }
  const fromPage = [...landing.matchAll(/publications\/legislative-calendar\/(\d{6})\.htm/gi)].map((m) => m[1]);
  const unique = [...new Set(fromPage)].sort((a, b) => njStampValue(b) - njStampValue(a));
  for (const stamp of unique) {
    const url = `${NJ_PUB}${stamp}.htm`;
    const html = await tryNjHtml(url);
    if (html) return { url, events: parseNj(html, url) };
  }

  const days: Date[] = [];
  const cursor = new Date();
  for (let i = 0; i < 45; i++) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }
  for (let i = 0; i < days.length; i += 7) {
    const chunk = days.slice(i, i + 7);
    const hits = await mapPool(chunk, 7, async (d) => {
      const url = `${NJ_PUB}${njStamp(d)}.htm`;
      const html = await tryNjHtml(url);
      return html ? { url, html } : null;
    });
    const found = hits.find(Boolean);
    if (found) return { url: found.url, events: parseNj(found.html, found.url) };
  }

  const html = await tryNjHtml(NJ_FALLBACK);
  if (!html) throw new Error("No NJ legislative calendar HTML found");
  return { url: NJ_FALLBACK, events: parseNj(html, NJ_FALLBACK) };
}

function parseNj(html: string, pageUrl: string): CalendarEvent[] {
  const text = stripTags(html).replace(/\u00a0/g, " ");
  const dayRe =
    /(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY),\s+(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+(\d{1,2}),\s+(\d{4})/gi;
  const marks = [...text.matchAll(dayRe)];
  const events: CalendarEvent[] = [];
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    const parsed = parseHumanDate(mark[0]);
    if (!parsed) continue;
    const from = (mark.index || 0) + mark[0].length;
    const to = i + 1 < marks.length ? marks[i + 1].index || text.length : text.length;
    events.push(...parseNjDay(parsed, text.slice(from, to), pageUrl));
  }
  return events.filter(usable);
}

function parseNjDay(parsed: { y: number; m: number; d: number }, block: string, pageUrl: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const push = (title: string, time?: string, location?: string, chamber?: string) => {
    const clean = cleanOfficialTitle(title.replace(/^\*+/, "").replace(/\(continued\)/gi, ""));
    if (!clean || junkOfficialTitle(clean)) return;
    if (/subject to change|denotes changes|prepared:|vol\.|check internet|office of legislative/i.test(clean)) {
      return;
    }
    if (/committee group\s*\([a-z]\)|^(senate|assembly)\s+chambers$/i.test(clean)) return;
    events.push(
      ev({
        sourceId: hashId("NJ", toIso(parsed.y, parsed.m, parsed.d, time), clean),
        state: "NJ",
        title: clean,
        start: toIso(parsed.y, parsed.m, parsed.d, time),
        location: location || "",
        chamber,
        url: pageUrl,
      }),
    );
  };

  const sessionRe =
    /\*?((?:SENATE|ASSEMBLY)\s+(?:SESSION|QUORUM))(?:\s+(\d{1,2}:\d{2}\s*[AP]M))?(?:\s+((?:Senate|Assembly)\s+Chambers))?/gi;
  let session: RegExpExecArray | null;
  while ((session = sessionRe.exec(block))) {
    const chamber = /senate/i.test(session[1]) ? "senate" : "house";
    push(session[1], session[2], session[3] || `${chamber === "senate" ? "Senate" : "Assembly"} Chambers`, chamber);
  }

  const timedRe = /(\d{1,2}:\d{2}\s*[AP]M)\s*:?\s+([^.]{8,90}?)(?=\s+\d{1,2}:\d{2}\s*[AP]M|\s+\*?(?:SENATE|ASSEMBLY)\s|$)/gi;
  let timed: RegExpExecArray | null;
  while ((timed = timedRe.exec(block))) {
    const title = timed[2].replace(/\s+/g, " ").trim();
    if (/\b(session|quorum)\b/i.test(title)) continue;
    const chamber = /senate/i.test(title) ? "senate" : /assembly/i.test(title) ? "house" : undefined;
    push(title, timed[1], /senate/i.test(block) && !/assembly/i.test(title) ? "Senate Chambers" : "Assembly Chambers", chamber);
  }

  return events;
}

function parseKy(html: string, pageUrl: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const parts = html.split(/<div[^>]*class="[^"]*DateHeading[^"]*"[^>]*>/i);
  for (const part of parts.slice(1)) {
    const dateText = stripTags(part.slice(0, part.indexOf("</div>") >= 0 ? part.indexOf("</div>") : 80));
    const currentDate = parseHumanDate(dateText);
    if (!currentDate) continue;
    const pairRe =
      /class="[^"]*TimeAndLocation[^"]*"[^>]*>([\s\S]*?)<\/div>[\s\S]{0,400}?class="[^"]*CommitteeName[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let m: RegExpExecArray | null;
    while ((m = pairRe.exec(part))) {
      const whenLoc = stripTags(m[1]);
      if (/cancelled/i.test(m[0])) continue;
      const title = stripTags(m[2]);
      const time = whenLoc.match(/\d{1,2}:\d{2}\s*(?:am|pm)/i)?.[0];
      const loc = whenLoc.replace(/^[^,]*,\s*/, "").trim();
      if (!title) continue;
      events.push(
        ev({
          sourceId: hashId("KY", toIso(currentDate.y, currentDate.m, currentDate.d, time), title),
          state: "KY",
          title,
          start: toIso(currentDate.y, currentDate.m, currentDate.d, time),
          location: loc,
          url: pageUrl,
        }),
      );
    }
  }
  return events;
}

function parseMn(html: string, pageUrl: string): CalendarEvent[] {
  if (pageUrl.includes("/api/") || html.trim().startsWith("{")) return parseMnSenateJson(html);
  return parseMnHouse(html, pageUrl);
}

function parseMnSenateJson(raw: string): CalendarEvent[] {
  try {
    const data = JSON.parse(raw) as {
      events?: Array<{
        hearing_id?: number;
        hearing_start?: string;
        hearing_room?: string;
        hearing_building?: string;
        hearing_notes?: string;
        committee?: { committee_name?: string };
      }>;
    };
    return (data.events || [])
      .map((row) => {
        const title = row.committee?.committee_name || "Senate hearing";
        const start = (row.hearing_start || "").replace(" ", "T");
        return ev({
          sourceId: row.hearing_id ? `mn-sen-${row.hearing_id}` : hashId("MN", start, title),
          state: "MN",
          title,
          start,
          location: [row.hearing_building, row.hearing_room].filter(Boolean).join(" "),
          chamber: "senate",
          description: row.hearing_notes || "",
          url: "https://www.senate.mn/schedule",
        });
      })
      .filter(usable);
  } catch {
    return [];
  }
}

function parseMnHouse(html: string, pageUrl: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const blocks = html.split(/<div[^>]*class="[^"]*card-header[^"]*"/i);
  for (const block of blocks.slice(1)) {
    const whenText = stripTags(block.match(/class="[^"]*text-white[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const parsed = parseHumanDate(whenText);
    if (!parsed) continue;
    const time = whenText.match(/\d{1,2}:\d{2}\s*[ap]m/i)?.[0];
    const title =
      stripTags(block.match(/<b>([\s\S]*?)<\/b>/i)?.[1] || "") ||
      stripTags(block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || "");
    if (!title) continue;
    const href = block.match(/href="([^"]+)"/i)?.[1];
    events.push(
      ev({
        sourceId: hashId("MN", toIso(parsed.y, parsed.m, parsed.d, time), title),
        state: "MN",
        title,
        start: toIso(parsed.y, parsed.m, parsed.d, time),
        chamber: /bg-joint/i.test(block) ? "joint" : "house",
        url: href ? absUrl(pageUrl, href) : pageUrl,
      }),
    );
  }
  return events;
}

function parseTx(html: string, pageUrl: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const chunks = html.split(/data-label="Committee Meeting Date">/i);
  for (const chunk of chunks.slice(1)) {
    const dateText = stripTags(chunk.slice(0, chunk.indexOf("</")));
    const parsed = parseHumanDate(dateText);
    if (!parsed) continue;
    const time = stripTags(chunk.match(/data-label="Committee Meeting Time">([\s\S]*?)<\//i)?.[1] || "").match(
      /\d{1,2}:\d{2}\s*[ap]m/i,
    )?.[0];
    const nameHtml = chunk.match(/data-label="Meeting Date \/ Committee Name">([\s\S]*?)<\/td>/i)?.[1] || "";
    const rawTitle = stripTags(nameHtml.split(/Type:/i)[0] || "").replace(/\s+/g, " ").trim();
    if (!rawTitle) continue;
    const chamber = /Chamber=S/i.test(pageUrl) ? "senate" : /Chamber=H/i.test(pageUrl) ? "house" : chamberFromTitle(rawTitle);
    const title = withChamberLabel(rawTitle, chamber === "senate" ? "Senate" : chamber === "house" ? "House" : "");
    const href = chunk.match(/href="([^"]*schedules\/html[^"]*)"/i)?.[1];
    events.push(
      ev({
        sourceId: hashId("TX", toIso(parsed.y, parsed.m, parsed.d, time), title),
        state: "TX",
        title,
        start: toIso(parsed.y, parsed.m, parsed.d, time),
        chamber,
        url: href ? absUrl(pageUrl, href) : pageUrl,
      }),
    );
  }
  return events;
}

function parseIl(html: string, pageUrl: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  const chamber = /\/senate\//i.test(pageUrl) ? "senate" : "house";
  while ((row = rowRe.exec(html))) {
    const body = row[1];
    const details = body.match(/hearings\/details\/(\d+)\/(\d+)/i);
    if (!details) continue;
    if (/\*{2,}\s*canceled/i.test(body)) continue;
    const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    const dateText = stripTags(cells[0] || "");
    const parsed = parseHumanDate(dateText);
    if (!parsed) continue;
    const info = stripTags(cells[1] || "");
    const time = info.match(/\d{1,2}:\d{2}\s*[ap]m/i)?.[0];
    const title = info
      .replace(/\d{1,2}:\d{2}\s*[ap]m\s*-?\s*/i, "")
      .split(/subject matter:/i)[0]
      .split(",")[0]
      .replace(/\s+/g, " ")
      .trim();
    if (!title) continue;
    const loc = (info.match(/\b([A-Z]-?\d[^.]{0,40}|room\s+\w+)/i) || [])[0] || "";
    const href = body.match(/href="([^"]*hearings\/details\/[^"]+)"/i)?.[1];
    events.push(
      ev({
        sourceId: `il-${details[2]}`,
        state: "IL",
        title,
        start: toIso(parsed.y, parsed.m, parsed.d, time),
        location: loc,
        chamber,
        url: href ? absUrl(pageUrl, href) : pageUrl,
      }),
    );
  }
  return events;
}

function parsePa(html: string, pageUrl: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const chamber = /\/senate\//i.test(pageUrl) ? "senate" : "house";
  const blocks = html.split(/meeting-featured-info-alt/i).slice(1);
  for (const block of blocks) {
    const title = cleanOfficialTitle(stripTags(block.match(/class="[^"]*h5[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || ""));
    if (!title || junkOfficialTitle(title)) continue;
    const gcal = block.match(/dates=(\d{8})T(\d{6})/i);
    const time = stripTags(block).match(/\d{1,2}:\d{2}\s*[ap]m/i)?.[0];
    const heading = stripTags(block.match(/<(?:h2|h3|h4)[^>]*>([\s\S]*?)<\/(?:h2|h3|h4)>/i)?.[1] || "");
    const parsed = gcal
      ? { y: Number(gcal[1].slice(0, 4)), m: Number(gcal[1].slice(4, 6)), d: Number(gcal[1].slice(6, 8)) }
      : parseHumanDate(heading) || parseHumanDate(stripTags(block.slice(0, 400)));
    if (!parsed) continue;
    const start = toIso(parsed.y, parsed.m, parsed.d, time);
    const loc = stripTags(block.match(/fa-location-pin[\s\S]{0,200}?<\/i>\s*([\s\S]*?)<\/div>/i)?.[1] || "");
    const href = block.match(/webcalendar\?meetingid=(\d+)/i)?.[1];
    events.push(
      ev({
        sourceId: href ? `pa-${chamber}-${href}` : hashId("PA", start, title),
        state: "PA",
        title,
        start,
        location: loc.replace(/\s+/g, " ").trim(),
        chamber,
        url: href ? `https://www.palegis.us/${chamber}/committees/webcalendar?meetingid=${href}` : pageUrl,
      }),
    );
  }
  return events.filter(usable);
}

async function fetchPaMeetings(): Promise<CalendarEvent[]> {
  const byId = new Map<string, CalendarEvent>();
  const errors: string[] = [];
  for (const [url, chamber] of [
    ["https://www.palegis.us/house/committees/webcalendar", "house"],
    ["https://www.palegis.us/senate/committees/webcalendar", "senate"],
  ] as const) {
    try {
      const rows = parseIcsText(await fetchText(url, 20000)).filter((e) => e.title && e.start);
      for (const row of rows) {
        const id = `pa-${chamber}-${row.sourceId}`.slice(0, 180);
        if (byId.has(id)) continue;
        byId.set(
          id,
          ev({
            sourceId: id,
            state: "PA",
            title: row.title,
            start: row.start,
            location: row.location || "",
            chamber,
            url: row.url || `https://www.palegis.us/${chamber}/committees/meeting-schedule`,
            description: row.description || "",
          }),
        );
      }
    } catch (err) {
      errors.push(`${chamber}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!byId.size && errors.length) throw new Error(errors.join("; "));
  return [...byId.values()].filter(usable);
}

function parseGenericLabeledRows(html: string, pageUrl: string, state: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html))) {
    const text = stripTags(row[1]);
    const parsed = parseHumanDate(text);
    if (!parsed) continue;
    const time = text.match(/\d{1,2}:\d{2}\s*[ap]m/i)?.[0];
    const titleCell = [...row[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)]
      .map((c) => stripTags(c[1]))
      .find((c) => c.length > 8 && !parseHumanDate(c) && !/^\d{1,2}:\d{2}/.test(c));
    const title = cleanOfficialTitle(titleCell || "");
    if (!title || junkOfficialTitle(title)) continue;
    events.push(
      ev({
        sourceId: hashId(state, toIso(parsed.y, parsed.m, parsed.d, time), title),
        state,
        title,
        start: toIso(parsed.y, parsed.m, parsed.d, time),
        url: pageUrl,
      }),
    );
  }
  return events;
}

async function fetchWaMeetings(): Promise<CalendarEvent[]> {
  const start = new Date();
  start.setDate(start.getDate() - 3);
  const end = new Date();
  end.setDate(end.getDate() + 45);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const xml = await fetchText(
    `https://wslwebservices.leg.wa.gov/CommitteeMeetingService.asmx/GetCommitteeMeetings?beginDate=${fmt(start)}&endDate=${fmt(end)}`,
  );
  const events: CalendarEvent[] = [];
  const blocks = xml.split(/<CommitteeMeeting>/i).slice(1);
  for (const block of blocks) {
    if (/<Cancelled>\s*true\s*<\/Cancelled>/i.test(block)) continue;
    const agendaId = tag(block, "AgendaId");
    const title = tag(block, "LongName") || tag(block, "Name") || "Committee meeting";
    const startAt = tag(block, "Date");
    if (!startAt || !title) continue;
    const loc = [tag(block, "Room"), tag(block, "Building"), tag(block, "City")].filter(Boolean).join(", ");
    const agency = tag(block, "Agency").toLowerCase();
    events.push(
      ev({
        sourceId: agendaId ? `wa-${agendaId}` : hashId("WA", startAt, title),
        state: "WA",
        title,
        start: startAt,
        location: loc,
        chamber: agency.includes("house") ? "house" : agency.includes("senate") ? "senate" : "joint",
        url: agendaId ? `https://app.leg.wa.gov/committeeschedules/Home/Agenda/${agendaId}` : "https://app.leg.wa.gov/committeeschedules/",
      }),
    );
  }
  return events;
}

async function fetchWaFloorCalendars(): Promise<CalendarEvent[]> {
  const { from, to } = upcomingWindow();
  const byId = new Map<string, CalendarEvent>();
  for (const [agency, chamber] of [
    ["House", "house"],
    ["Senate", "senate"],
  ] as const) {
    try {
      const html = await fetchText(`https://app.leg.wa.gov/far/CalendarNavigation?agency=${agency}`, 18000);
      const title = `${agency} Floor Session`;
      for (const m of html.matchAll(/<option value="(\d+)">\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*</gi)) {
        const parsed = parseHumanDate(m[2]);
        if (!parsed) continue;
        const start = toIso(parsed.y, parsed.m, parsed.d);
        const day = start.slice(0, 10);
        if (day < from || day > to) continue;
        const id = `wa-far-${chamber}-${m[1]}`;
        if (byId.has(id)) continue;
        byId.set(
          id,
          ev({
            sourceId: id,
            state: "WA",
            title,
            start,
            chamber,
            url: `https://app.leg.wa.gov/far/${agency}/Calendar/Report/${m[1]}`,
            allDay: true,
          }),
        );
      }
    } catch {
      /* one chamber FAR page can fail */
    }
  }
  return [...byId.values()].filter(usable);
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? stripTags(m[1]) : "";
}

type KsHearing = {
  committee_kpid?: string;
  committee_title?: string;
  chamber?: string;
  hearing_date?: string;
  hearing_time?: string;
  hearing_datetime?: string;
  room?: string;
  status?: string;
  hearing_type?: string;
  bill_numbers?: string[];
};

function ksLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function fetchKsHearings(): Promise<CalendarEvent[]> {
  const from = new Date();
  from.setMonth(from.getMonth() - 8);
  const to = new Date();
  to.setDate(to.getDate() + 90);
  const byId = new Map<string, CalendarEvent>();
  const limit = 200;
  for (let offset = 0; offset < 1000; offset += limit) {
    const data = await fetchJson<{ results?: KsHearing[] }>(
      `https://kslegislature.gov/api/v1/hearings/?from=${ksLocalDate(from)}&to=${ksLocalDate(to)}&limit=${limit}&offset=${offset}`,
    );
    const rows = Array.isArray(data.results) ? data.results : [];
    for (const row of rows) {
      if (/cancel/i.test(row.status || "")) continue;
      const title = row.committee_title || row.hearing_type || "Hearing";
      const parsed = parseHumanDate(row.hearing_date || "");
      const start = parsed
        ? toIso(parsed.y, parsed.m, parsed.d, row.hearing_time)
        : row.hearing_datetime?.replace(/Z$/, "") || "";
      if (!title || !start) continue;
      const id = hashId("KS", start, `${row.committee_kpid || ""}|${title}|${row.room || ""}`);
      if (byId.has(id)) continue;
      const chamber = (row.chamber || "").toLowerCase();
      byId.set(
        id,
        ev({
          sourceId: id,
          state: "KS",
          title,
          start,
          location: row.room || "",
          chamber: chamber.includes("senate") ? "senate" : chamber.includes("house") ? "house" : "",
          url: "https://kslegislature.gov/b2025_26/hearings/",
          bills: row.bill_numbers || [],
        }),
      );
    }
    if (rows.length < limit) break;
  }
  try {
    const specials = await fetchKsSpecialPages();
    for (const row of specials) {
      if (!byId.has(row.sourceId)) byId.set(row.sourceId, row);
    }
  } catch {
    /* special committee pages are extra */
  }
  try {
    const pdfRows = await fetchKsInterimPdf();
    for (const row of pdfRows) {
      if (!byId.has(row.sourceId)) byId.set(row.sourceId, row);
    }
  } catch {
    /* homepage interim PDF is extra */
  }
  return [...byId.values()].filter(usable);
}

function parseKsInterimPdf(text: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const year = new Date().getFullYear();
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const startRe =
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?\s+(\d{1,2})\s+(\S+)\s+(TBD|\d{1,2}:\d{2}\s*[ap]m)\s+(.*)$/i;
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(startRe);
    i += 1;
    if (!m) continue;
    let title = m[5].replace(/\bAgenda\b/gi, " ").replace(/\s+/g, " ").trim();
    while (i < lines.length && !startRe.test(lines[i])) {
      const next = lines[i];
      if (/^agenda$/i.test(next) || /^(note:|state of kansas|this notice covers|date room time)/i.test(next)) {
        i += 1;
        break;
      }
      i += 1;
      const extra = next.replace(/\bAgenda\b/gi, " ").trim();
      if (extra) title = `${title} ${extra}`.replace(/\s+/g, " ").trim();
    }
    title = title.replace(/^(J|H|S)[-\s]+/i, "").trim();
    const parsed = parseHumanDate(`${m[1]} ${m[2]} ${year}`);
    if (!parsed || !title || junkOfficialTitle(title)) continue;
    const start = toIso(parsed.y, parsed.m, parsed.d, /tbd/i.test(m[4]) ? "" : m[4]);
    const id = hashId("KS", start, title);
    if (byId.has(id)) continue;
    const prefix = (m[5].match(/^(J|H|S)[-\s]/i) || [])[1] || "";
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "KS",
        title: cleanOfficialTitle(title),
        start,
        location: m[3],
        chamber: /^s$/i.test(prefix) ? "senate" : /^h$/i.test(prefix) ? "house" : "joint",
        url: pageUrl,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

async function fetchKsInterimPdf(): Promise<CalendarEvent[]> {
  const home = await fetchText("https://kslegislature.gov/", 20000);
  const hrefs = [...home.matchAll(/href="([^"]*interim_schedule[^"]*\.pdf[^"]*)"/gi)].map((m) => m[1]);
  const ranked = hrefs.sort((a, b) => {
    const num = (s: string) => Number((s.match(/interim_schedule-(\d+)/i) || [])[1] || 0);
    return num(b) - num(a);
  });
  const urls = [
    ...ranked.map((h) => absUrl("https://kslegislature.gov/", h)),
    "https://kslegislature.gov/b2025_26/bills/download/?apn=b2025_26/recent_docs/interim_schedule.pdf",
  ];
  for (const url of [...new Set(urls)]) {
    try {
      const rows = parseKsInterimPdf(await fetchPdfText(url), url);
      if (rows.length) return rows;
    } catch {
      /* try next numbered schedule */
    }
  }
  return [];
}

type KsCommittee = { kpid?: string; title?: string; chamber?: string; committee_type?: string; status?: string };

async function fetchKsSpecialPages(): Promise<CalendarEvent[]> {
  const data = await fetchJson<{ results?: KsCommittee[] }>("https://kslegislature.gov/api/v1/committees/?limit=200");
  const wanted = (data.results || []).filter(
    (c) =>
      /active/i.test(c.status || "Active") &&
      /special|post audit|interim|task force/i.test(`${c.committee_type} ${c.title} ${c.kpid}`),
  );
  const window = upcomingWindow();
  const pages = await mapPool(wanted.slice(0, 25), 4, async (com) => {
    const kpid = com.kpid;
    if (!kpid) return [] as CalendarEvent[];
    try {
      const html = await fetchText(`https://kslegislature.gov/b2025_26/committees/${kpid}/`, 20000);
      const dates =
        html.match(
          /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+2026\b/gi,
        ) || [];
      const title = com.title || "Special committee";
      const chamber = (com.chamber || "").toLowerCase();
      return [...new Set(dates)].slice(0, 8).flatMap((raw) => {
        const parsed = parseHumanDate(raw);
        if (!parsed) return [];
        const start = toIso(parsed.y, parsed.m, parsed.d);
        const day = start.slice(0, 10);
        if (day < window.from || day > window.to) return [];
        return [
          ev({
            sourceId: hashId("KS", start, title),
            state: "KS",
            title,
            start,
            chamber: chamber.includes("senate") ? "senate" : chamber.includes("house") ? "house" : "joint",
            url: `https://kslegislature.gov/b2025_26/committees/${kpid}/`,
          }),
        ];
      });
    } catch {
      return [] as CalendarEvent[];
    }
  });
  return pages.flat().filter(usable);
}

const MI_RSS = [
  "https://www.legislature.mi.gov/documents/publications/RssFeeds/comschedule.xml",
  "https://legislature.mi.gov/documents/publications/RssFeeds/comschedule.xml",
];
const MI_PAGES = [
  "https://www.legislature.mi.gov/Committees/Meetings?sortBy=CalendarTime",
  "https://www.legislature.mi.gov/Committees/Meetings?sortBy=Date",
  "https://legislature.mi.gov/Committees/Meetings",
];

function parseMiRssTitle(title: string): { chamber: string; name: string; date: string; time: string } | null {
  const m = title.match(
    /^(House|Senate)\s+Meeting\s+-\s+(.+?)\s+(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+(\d{1,2}:\d{2}\s*[AP]M))?/i,
  );
  if (!m) return null;
  return { chamber: m[1].toLowerCase() === "senate" ? "senate" : "house", name: m[2].trim(), date: m[3], time: m[4] || "" };
}

function parseMiRss(xml: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  for (const item of xml.split(/<item[\s>]/i).slice(1)) {
    const rawTitle = stripTags(tag(item, "title"));
    const link = stripTags(tag(item, "link")) || "https://www.legislature.mi.gov/Committees/Meetings";
    const desc = stripTags(tag(item, "description"));
    if (/cancelled/i.test(desc) || /cancelled/i.test(rawTitle)) continue;
    const parsedTitle = parseMiRssTitle(rawTitle);
    const parsed = parsedTitle ? parseHumanDate(parsedTitle.date) : parseHumanDate(`${rawTitle} ${desc}`);
    const title = cleanOfficialTitle(
      parsedTitle?.name || rawTitle.replace(/^House Meeting -\s*/i, "").replace(/^Senate Meeting -\s*/i, ""),
    );
    if (!title || !parsed || junkOfficialTitle(title) || /funds*(rep\.|sen\.)/i.test(title)) continue;
    const start = toIso(parsed.y, parsed.m, parsed.d, parsedTitle?.time);
    const guid = stripTags(tag(item, "guid")) || hashId("MI", start, title);
    const id = `mi-${guid}`;
    if (byId.has(id)) continue;
    const chamber = parsedTitle?.chamber || (/senate/i.test(rawTitle) ? "senate" : /house/i.test(rawTitle) ? "house" : "");
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "MI",
        title,
        start,
        chamber,
        url: link,
        description: desc,
      }),
    );
  }
  return [...byId.values()];
}

function parseMiMeetingsPage(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const sessionRe = /(House|Senate)\s+adjourned until\s+([^<\n]+)/gi;
  let banner: RegExpExecArray | null;
  while ((banner = sessionRe.exec(html))) {
    const parsed = parseHumanDate(banner[2]);
    if (!parsed) continue;
    const time = banner[2].match(/\d{1,2}:\d{2}\s*[ap]m/i)?.[0];
    const chamber = banner[1].toLowerCase() === "senate" ? "senate" : "house";
    const title = `${banner[1]} Session`;
    const start = toIso(parsed.y, parsed.m, parsed.d, time);
    const id = hashId("MI", start, title);
    if (byId.has(id)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "MI",
        title,
        start,
        chamber,
        url: pageUrl,
      }),
    );
  }
  const cellRe =
    /meetingID=(\d+)[\s\S]{0,500}?(?:>([HS])<|(?:>(House|Senate)\b))?[\s\S]{0,300}?<a[^>]+meetingID=\1[^>]*>([\s\S]*?)<\/a>[\s\S]{0,200}?(\d{1,2}:\d{2}\s*[AP]M)[\s\S]{0,120}?(cancelled)?/gi;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(html))) {
    if (m[6]) continue;
    const title = cleanOfficialTitle(stripTags(m[4]));
    if (!title || junkOfficialTitle(title) || /funds*(rep\.|sen\.)/i.test(title)) continue;
    const around = html.slice(Math.max(0, m.index - 400), m.index + 200);
    const parsed = parseHumanDate(around) || parseHumanDate(stripTags(around));
    if (!parsed) continue;
    const chamberRaw = (m[2] || m[3] || "").toLowerCase();
    const chamber = chamberRaw.startsWith("s") ? "senate" : chamberRaw.startsWith("h") ? "house" : "";
    const start = toIso(parsed.y, parsed.m, parsed.d, m[5]);
    const id = `mi-${m[1]}`;
    if (byId.has(id)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "MI",
        title,
        start,
        chamber,
        url: `https://www.legislature.mi.gov/Committees/Meeting?meetingID=${m[1]}`,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

export async function fetchMiMeetings(): Promise<CalendarEvent[]> {
  const byId = new Map<string, CalendarEvent>();
  const add = (rows: CalendarEvent[]) => {
    for (const e of rows) if (!byId.has(e.sourceId)) byId.set(e.sourceId, e);
  };
  const errors: string[] = [];
  for (const url of MI_RSS) {
    try {
      add(parseMiRss(await fetchText(url, 18000)));
      break;
    } catch (err) {
      errors.push(`rss ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const url of MI_PAGES) {
    try {
      add(parseMiMeetingsPage(await fetchText(url, 20000), url));
      if (byId.size) break;
    } catch (err) {
      errors.push(`page ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!byId.size && errors.length) throw new Error(errors.join("; "));
  return [...byId.values()].filter(usable);
}

const RI_HOME = "https://www.rilegislature.gov/Pages/Default.aspx";
const RI_STATUS = "https://status.rilegislature.gov/legislative_committee_calendar.aspx";

function riChamber(title: string): string {
  const t = title.toLowerCase();
  if (/\bjoint\b/.test(t)) return "joint";
  if (/\bsenate\b/.test(t)) return "senate";
  if (/\bhouse\b/.test(t)) return "house";
  return "";
}

function riHiddenInputs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of html.match(/<input\b[^>]*>/gi) || []) {
    if (!/type\s*=\s*["']hidden["']/i.test(tag)) continue;
    const name = tag.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!name) continue;
    out[name] = decodeEntities(tag.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] || "");
  }
  return out;
}

function parseRiDotUrls(html: string, pageUrl: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const re = /href\s*=\s*['"]([^'"]*CalendarEvent\/CalendarEvent\.aspx\?[^'"]*date=\d{1,2}\/\d{1,2}\/\d{4}[^'"]*)['"]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = absUrl(pageUrl, decodeEntities(m[1]));
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function riCalendarNext(html: string): { target: string; arg: string } | null {
  const m = html.match(/__doPostBack\('([^']*Calendar1)','(V\d+)'\)[\s\S]{0,180}?next month/i);
  if (!m) return null;
  return { target: m[1], arg: m[2] };
}

function riAgendaKey(url: string): string {
  try {
    const path = decodeURIComponent(new URL(url).pathname).toLowerCase();
    const file = path.split("/").filter(Boolean).pop() || "";
    return /\.(pdf|html?)$/i.test(file) ? file.replace(/\.(pdf|html?)$/i, "").replace(/[^a-z0-9]+/g, " ").trim() : "";
  } catch {
    return "";
  }
}

function riNormTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function riTitleTokens(title: string): Set<string> {
  const stop = new Set([
    "the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "at", "by", "with", "from",
    "agenda", "hearing", "meeting", "special", "legislative", "commission", "committee",
    "house", "senate", "joint", "state",
  ]);
  return new Set(
    riNormTitle(title)
      .split(" ")
      .filter((w) => w.length > 2 && !stop.has(w)),
  );
}

function riTitlesMatch(a: string, b: string): boolean {
  const na = riNormTitle(a);
  const nb = riNormTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if ((na.length >= 24 || nb.length >= 24) && (na.includes(nb) || nb.includes(na))) return true;
  const ta = riTitleTokens(a);
  const tb = riTitleTokens(b);
  if (!ta.size || !tb.size) return false;
  let inter = 0;
  for (const tok of ta) if (tb.has(tok)) inter += 1;
  return inter >= 3 && inter / (ta.size + tb.size - inter) >= 0.62;
}

function riSameMeeting(a: CalendarEvent, b: CalendarEvent): boolean {
  if (a.start.slice(0, 10) !== b.start.slice(0, 10)) return false;
  const agendaA = riAgendaKey(a.url || "");
  const agendaB = riAgendaKey(b.url || "");
  if (agendaA && agendaB && agendaA === agendaB) return true;
  if (!riTitlesMatch(a.title, b.title)) return false;
  const timeA = a.start.slice(11, 16);
  const timeB = b.start.slice(11, 16);
  return timeA === timeB || timeA === "00:00" || timeB === "00:00";
}

function collapseRiDuplicates(rows: CalendarEvent[]): CalendarEvent[] {
  const kept: CalendarEvent[] = [];
  for (const row of rows) {
    const idx = kept.findIndex((prev) => riSameMeeting(prev, row));
    if (idx < 0) kept.push(row);
    else kept[idx] = mergeOfficialEvent(kept[idx], row);
  }
  return kept;
}

function parseRi(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const table = html.match(/id="[^"]*eventGridView"[\s\S]*?<\/table>/i)?.[0] || "";
  const source = table || html;
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(source))) {
    if (/<th\b/i.test(row[1]) && !/<td\b/i.test(row[1])) continue;
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => stripTags(c[1]));
    if (cells.length < 3) continue;
    const parsed = parseHumanDate(cells.find((c) => parseHumanDate(c)) || "") || parseHumanDate(cells[0] || "");
    const timeCell = cells.find((c) => /\d{1,2}:\d{2}\s*[ap]m/i.test(c) || /rise of the/i.test(c)) || cells[1] || "";
    const time = timeCell.match(/\d{1,2}:\d{2}\s*[ap]m/i)?.[0];
    const title = cleanOfficialTitle(
      table
        ? cells[2] || ""
        : cells.find((c) => {
            if (!c || parseHumanDate(c) || /^(pdf|html)$/i.test(c) || /^\d{1,2}:\d{2}\s*[ap]m$/i.test(c)) return false;
            if (/^(room\b|.*state house$)/i.test(c) && c.length < 48) return false;
            return c.length >= 8;
          }) || "",
    );
    if (!parsed || !title || junkOfficialTitle(title)) continue;
    const loc = cells.find((c) => /room|chamber|lounge|state house/i.test(c) && c !== title && !parseHumanDate(c)) || "";
    const href =
      row[1].match(/href="([^"]+\.pdf[^"]*)"/i)?.[1] ||
      row[1].match(/href="([^"]+\.html?[^"]*)"/i)?.[1] ||
      pageUrl;
    const start = toIso(parsed.y, parsed.m, parsed.d, time);
    const id = hashId("RI", start, title);
    if (byId.has(id)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "RI",
        title,
        start,
        location: loc,
        chamber: riChamber(title),
        url: absUrl(pageUrl, href),
        allDay: /rise of the/i.test(timeCell) && !time,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

async function fetchRiHomeCalendar(): Promise<CalendarEvent[]> {
  let html = "";
  try {
    html = await fetchText(RI_HOME, 20000);
  } catch {
    return [];
  }
  const dayUrls = new Set<string>(parseRiDotUrls(html, RI_HOME));
  for (let i = 0; i < 3; i++) {
    const next = riCalendarNext(html);
    if (!next) break;
    const fields = riHiddenInputs(html);
    fields.__EVENTTARGET = next.target;
    fields.__EVENTARGUMENT = next.arg;
    const body = Object.entries(fields)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    try {
      html = await fetchTextPost(RI_HOME, body, 20000, { Referer: RI_HOME, "X-Requested-With": "" });
    } catch {
      break;
    }
    if (!/myCalendarDay/i.test(html)) break;
    for (const url of parseRiDotUrls(html, RI_HOME)) dayUrls.add(url);
  }
  if (!dayUrls.size) return [];
  const pages = await mapPool([...dayUrls], 4, async (url) => {
    try {
      return parseRi(await fetchText(url, 12000, { Referer: RI_HOME }), url);
    } catch {
      return [] as CalendarEvent[];
    }
  });
  return pages.flat();
}

export async function fetchRiCalendar(): Promise<CalendarEvent[]> {
  const byId = new Map<string, CalendarEvent>();
  const add = (rows: CalendarEvent[]) => {
    for (const e of rows) {
      if (e.sourceId && !byId.has(e.sourceId)) byId.set(e.sourceId, e);
    }
  };

  try {
    add(await fetchRiHomeCalendar());
  } catch {
    /* homepage calendar dots are the session/interim schedule */
  }
  try {
    add(parseRi(await fetchText(RI_STATUS, 12000), RI_STATUS));
  } catch {
    /* off-session committee calendar is often empty */
  }

  return collapseRiDuplicates([...byId.values()].filter(usable));
}

const WV_INTERIMS = "https://www.wvlegislature.gov/Committees/Interims/interims.cfm";
const WV_SCHED = "https://www.wvlegislature.gov/committees/interims/intcomsched.cfm";

function wvChamber(title: string): string {
  const t = title.toLowerCase();
  if (/\bhouse only\b|\bhouse\b/.test(t) && !/\bjoint\b|\bsenate\b/.test(t)) return "house";
  if (/\bsenate\b/.test(t) && !/\bjoint\b|\bhouse\b/.test(t)) return "senate";
  return "joint";
}

function parseWvSchedule(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const blocks = html.split(/<h2>/i).slice(1);
  for (const block of blocks) {
    const heading = stripTags((block.match(/^([\s\S]*?)<\/h2>/i) || [])[1] || "");
    const parsed = parseHumanDate(heading);
    if (!parsed) continue;
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let row: RegExpExecArray | null;
    while ((row = rowRe.exec(block))) {
      if (/<th/i.test(row[1])) continue;
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
      if (cells.length < 3) continue;
      const time = stripTags(cells[0] || "");
      const titleHtml = cells[2] || "";
      const title = cleanOfficialTitle(
        stripTags(titleHtml).replace(/\s*-\s*Agenda\s*$/i, "").replace(/\s+CANCELLED\s*$/i, ""),
      );
      if (!title || /cancelled/i.test(stripTags(titleHtml)) || junkOfficialTitle(title)) continue;
      const loc = stripTags(cells[3] || "");
      const agenda = titleHtml.match(/href="([^"]*Agenda\.cfm[^"]*)"/i)?.[1];
      const committee = titleHtml.match(/href="([^"]*committee\.cfm[^"]*)"/i)?.[1];
      const start = toIso(parsed.y, parsed.m, parsed.d, time);
      const id = hashId("WV", start, title);
      if (byId.has(id)) continue;
      byId.set(
        id,
        ev({
          sourceId: id,
          state: "WV",
          title,
          start,
          location: loc,
          chamber: wvChamber(title),
          url: absUrl(pageUrl, agenda || committee || pageUrl),
        }),
      );
    }
  }
  return [...byId.values()].filter(usable);
}

export async function fetchWvInterims(): Promise<CalendarEvent[]> {
  const index = await fetchText(WV_INTERIMS);
  const days = new Set<string>();
  for (const m of index.matchAll(/intcomsched\.cfm\?day1=(\d{1,2}\/\d{1,2}\/\d{4})/gi)) {
    const parsed = parseHumanDate(m[1]);
    if (parsed && parsed.y >= new Date().getFullYear() - 1) days.add(m[1]);
  }
  for (const extra of ["09/13/2026", "12/06/2026"]) {
    const parsed = parseHumanDate(extra);
    if (parsed && parsed.y >= new Date().getFullYear()) days.add(extra);
  }
  if (!days.size) days.add("");

  const pages = await mapPool([...days], 4, async (day) => {
    const url = day ? `${WV_SCHED}?day1=${encodeURIComponent(day)}` : WV_SCHED;
    try {
      return parseWvSchedule(await fetchText(url, 14000), url);
    } catch {
      return [] as CalendarEvent[];
    }
  });
  const byId = new Map<string, CalendarEvent>();
  for (const rows of pages) {
    for (const e of rows) {
      if (!byId.has(e.sourceId)) byId.set(e.sourceId, e);
    }
  }
  return [...byId.values()].filter(usable);
}

function parseUt(html: string, pageUrl: string): CalendarEvent[] {
  const heading = stripTags(html.match(/id=["']datestr["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "");
  const ym = parseHumanDate(`1 ${heading}`) || parseHumanDate(heading);
  const urlMonth = Number(pageUrl.match(/[?&]month=(\d{1,2})/i)?.[1] || 0);
  const urlYear = Number(pageUrl.match(/[?&]year=(\d{4})/i)?.[1] || 0);
  const year = ym?.y || urlYear || new Date().getFullYear();
  const month = ym?.m || urlMonth || new Date().getMonth() + 1;
  const byId = new Map<string, CalendarEvent>();
  const parts = html.split(/id="cell\d+"/i).slice(1);
  for (const part of parts) {
    const day = Number(stripTags(part.match(/class="calHeader"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "").replace(/\D/g, ""));
    if (!day) continue;
    const boxes = part.split(/class="mtgBox[^"]*"/i).slice(1);
    for (const box of boxes) {
      const title = cleanOfficialTitle(stripTags(box.match(/<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] || ""));
      if (!title || junkOfficialTitle(title) || /more\s*$/i.test(title)) continue;
      const time = clockTime(stripTags(box.match(/class="timecell"[^>]*>([\s\S]*?)<\/td>/i)?.[1] || ""));
      const loc = decodeEntities(box.match(/class="cmapdiv"[^>]*title="([^"]+)"/i)?.[1] || "");
      const mtgid = box.match(/mtgid=(\d+)/i)?.[1];
      const href = box.match(/<a[^>]*href="([^"]+)"/i)?.[1];
      const start = toIso(year, month, day, time);
      const id = mtgid ? `ut-${mtgid}` : hashId("UT", start, title);
      if (byId.has(id)) continue;
      byId.set(
        id,
        ev({
          sourceId: id,
          state: "UT",
          title,
          start,
          location: loc,
          chamber: chamberFromTitle(title, "joint"),
          url: absUrl(pageUrl, href || (mtgid ? `/ics.jsp?mtgid=${mtgid}` : pageUrl)),
        }),
      );
    }
  }
  return [...byId.values()].filter(usable);
}

async function fetchUtCalendar(): Promise<CalendarEvent[]> {
  const now = new Date();
  const urls: string[] = [];
  for (let i = -1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    urls.push(`https://le.utah.gov/asp/interim/Cal.asp?year=${d.getFullYear()}&month=${d.getMonth() + 1}`);
  }
  const pages = await mapPool(urls, 3, async (url) => {
    try {
      return parseUt(await fetchText(url, 16000), url);
    } catch {
      return [] as CalendarEvent[];
    }
  });
  const byId = new Map<string, CalendarEvent>();
  for (const rows of pages) {
    for (const e of rows) {
      if (!byId.has(e.sourceId)) byId.set(e.sourceId, e);
    }
  }
  return [...byId.values()].filter(usable);
}

function parseCt(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const blockRe = /class=['"]addeventatc['"]([\s\S]{0,1500}?)<\/a>/gi;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(html))) {
    const chunk = block[1] || "";
    const title = cleanOfficialTitle(stripTags(chunk.match(/class=['"]_summary['"]>([\s\S]*?)<\/span>/i)?.[1] || ""));
    const when = stripTags(chunk.match(/class=['"]_start['"]>([\s\S]*?)<\/span>/i)?.[1] || "");
    const loc = stripTags(chunk.match(/class=['"]_location['"]>([\s\S]*?)<\/span>/i)?.[1] || "");
    if (!title || /^cancelled:/i.test(title) || junkOfficialTitle(title)) continue;
    const parsed = parseLooseDate(when);
    if (!parsed) continue;
    const time = clockTime(when.match(/\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M/i)?.[0] || "");
    const start = toIso(parsed.y, parsed.m, parsed.d, time);
    const id = hashId("CT", start, title);
    if (byId.has(id)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "CT",
        title,
        start,
        location: loc,
        chamber: chamberFromTitle(title),
        url: pageUrl,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

function ctStamp(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

async function fetchCtEvents(): Promise<CalendarEvent[]> {
  const pageUrl = "https://www.cga.ct.gov/webapps/cgaevents.asp";
  const postUrl = "https://www.cga.ct.gov/webapps/in-events1x.asp";
  const byId = new Map<string, CalendarEvent>();
  const add = (rows: CalendarEvent[]) => {
    for (const e of rows) if (!byId.has(e.sourceId)) byId.set(e.sourceId, e);
  };
  const errors: string[] = [];
  try {
    add(parseCt(await fetchText(pageUrl, 18000), pageUrl));
  } catch (err) {
    errors.push(`page ${err instanceof Error ? err.message : String(err)}`);
  }
  const start = new Date();
  start.setDate(start.getDate() - 2);
  const windows = Array.from({ length: 8 }, (_, i) => {
    const from = new Date(start);
    from.setDate(start.getDate() + i * 7);
    const to = new Date(from);
    to.setDate(from.getDate() + 6);
    return { from, to };
  });
  const windowRows = await mapPool(windows, 4, async ({ from, to }) => {
    try {
      return parseCt(
        await fetchTextPost(postUrl, `sDate=${ctStamp(from)}&eDate=${ctStamp(to)}`, 16000, { Referer: pageUrl }),
        pageUrl,
      );
    } catch (err) {
      errors.push(`window ${ctStamp(from)} ${err instanceof Error ? err.message : String(err)}`);
      return [] as CalendarEvent[];
    }
  });
  for (const rows of windowRows) add(rows);
  if (!byId.size && errors.length) throw new Error(errors.join("; "));
  return [...byId.values()].filter(usable);
}

function parseMeWeek(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const blocks = html.split(/<h3\b/i).slice(1);
  for (const block of blocks) {
    const heading = stripTags((block.match(/^[^>]*>([\s\S]*?)<\/h3>/i) || [])[1] || "");
    const parsed = parseHumanDate(heading);
    if (!parsed) continue;
    const items = block.split(/class="list-group-item"/i).slice(1);
    for (const item of items) {
      const time = clockTime(stripTags(item.match(/class="badge[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || ""));
      const titleRaw = stripTags(item.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i)?.[1] || "");
      const title = cleanOfficialTitle(titleRaw.replace(/\d{1,2}:\d{2}\s*[AP]M/i, ""));
      if (!title || junkOfficialTitle(title)) continue;
      const loc = stripTags(item.match(/fa-map-marker-alt[\s\S]*?<\/i>\s*([\s\S]*?)<\/p>/i)?.[1] || "");
      const start = toIso(parsed.y, parsed.m, parsed.d, time);
      const id = hashId("ME", start, title);
      if (byId.has(id)) continue;
      byId.set(
        id,
        ev({
          sourceId: id,
          state: "ME",
          title,
          start,
          location: loc,
          chamber: chamberFromTitle(title, "joint"),
          url: pageUrl,
        }),
      );
    }
  }
  return [...byId.values()].filter(usable);
}

async function fetchMeWeekly(): Promise<CalendarEvent[]> {
  const indexUrl = "https://legislature.maine.gov/house/Documents/WLC";
  const index = await fetchText(indexUrl, 18000);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const m of index.matchAll(/href="(\/house\/Documents\/WLCList\/(\d+))"[^>]*>[\s\S]*?View\s+(\d+)\s+Item/gi)) {
    const id = m[2];
    if (Number(m[3]) < 1 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= 10) break;
  }
  const pages = await mapPool(ids, 3, async (id) => {
    const url = `https://legislature.maine.gov/house/Documents/WLCList/${id}`;
    try {
      return parseMeWeek(await fetchText(url, 16000), url);
    } catch {
      return [] as CalendarEvent[];
    }
  });
  const byId = new Map<string, CalendarEvent>();
  for (const rows of pages) {
    for (const e of rows) {
      if (!byId.has(e.sourceId)) byId.set(e.sourceId, e);
    }
  }
  return [...byId.values()].filter(usable);
}

function parseLa(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  let chamber = "joint";
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html))) {
    const chunk = row[1];
    const head = stripTags(chunk.match(/<th[^>]*>([\s\S]*?)<\/th>/i)?.[1] || "");
    if (/house committee/i.test(head)) {
      chamber = "house";
      continue;
    }
    if (/senate committee/i.test(head)) {
      chamber = "senate";
      continue;
    }
    if (/joint committee/i.test(head)) {
      chamber = "joint";
      continue;
    }
    if (/no meetings are scheduled/i.test(chunk)) continue;
    const link = chunk.match(/href="([^"]*Agenda\.aspx\?m=(\d+))"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const cells = [...chunk.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => stripTags(c[1]));
    const title = cleanOfficialTitle(stripTags(link[3]));
    const when = cells.find((c) => /\d{1,2}\/\d{1,2}/.test(c) || /\d{1,2}:\d{2}/.test(c)) || cells[1] || "";
    if (!title || /cancel/i.test(cells.join(" ")) || junkOfficialTitle(title)) continue;
    const parsed = parseLooseDate(when);
    if (!parsed) continue;
    const time = clockTime(when.match(/\d{1,2}:\d{2}\s*[ap]\.?m\.?/i)?.[0] || "");
    const loc = cells.find((c) => /room|chamber|association|hainkel/i.test(c)) || cells[2] || "";
    const start = toIso(parsed.y, parsed.m, parsed.d, time);
    const id = `la-${link[2]}`;
    if (byId.has(id)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "LA",
        title,
        start,
        location: loc,
        chamber,
        url: absUrl(pageUrl, link[1]),
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

async function fetchLaMeetings(): Promise<CalendarEvent[]> {
  const byId = new Map<string, CalendarEvent>();
  const add = async (url: string, chamber: string, kind: "bycmte" | "chamber") => {
    try {
      const html = await fetchText(url, 18000);
      const rows = kind === "bycmte" ? parseLa(html, url) : parseLaChamber(html, chamber, url);
      for (const row of rows) {
        if (!byId.has(row.sourceId)) byId.set(row.sourceId, row);
      }
    } catch {
      /* one LA schedule page can fail */
    }
  };
  await add("https://legis.la.gov/legis/ByCmte.aspx", "joint", "bycmte");
  await add("https://house.louisiana.gov/H_Sched/Hse_MeetingSchedule", "house", "chamber");
  await add("https://senate.la.gov/Sched/S_Sched", "senate", "chamber");
  return [...byId.values()].filter(usable);
}

function parseLaChamber(html: string, chamber: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const nameRe = /CMTENAMELabel_\d+"[^>]*>([\s\S]*?)<\/span>/gi;
  let name: RegExpExecArray | null;
  while ((name = nameRe.exec(html))) {
    const chunk = html.slice(name.index, name.index + 900);
    const title = cleanOfficialTitle(stripTags(name[1] || ""));
    const whenLoc = stripTags(chunk.match(/DATETIMELOCLabel_\d+"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    if (!title || !whenLoc || junkOfficialTitle(title)) continue;
    if (/cancel|not meeting|no meetings|no committee/i.test(`${title} ${whenLoc}`)) continue;
    const parsed = parseLooseDate(whenLoc);
    if (!parsed) continue;
    const time = clockTime(whenLoc.match(/\d{1,2}:\d{2}\s*[ap]\.?m\.?/i)?.[0] || "");
    const loc = whenLoc.replace(/^[^,]*,\s*[^,]*,\s*/, "").trim();
    const agenda = chunk.match(/href="([^"]*Agenda\.aspx\?m=(\d+))"/i);
    const start = toIso(parsed.y, parsed.m, parsed.d, time);
    const id = agenda?.[2] ? `la-${agenda[2]}` : hashId("LA", start, title);
    if (byId.has(id)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "LA",
        title,
        start,
        location: loc,
        chamber: /joint/i.test(title) ? "joint" : chamber,
        url: agenda?.[1] ? absUrl(pageUrl, agenda[1]) : pageUrl,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

function parseScMeetings(html: string, pageUrl: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  let currentDate: { y: number; m: number; d: number } | null = null;
  const re =
    /<(?:span|div)[^>]*>\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([^<]+?)\s*<\/(?:span|div)>|(\d{1,2}:\d{2}\s*[ap]m)(?:<\/span>)?\s*--\s*([^-]+?)\s*--\s*([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1] && m[2]) {
      currentDate = parseHumanDate(m[2]);
      continue;
    }
    if (!currentDate || !m[3]) continue;
    const title = cleanOfficialTitle(stripTags(m[5] || ""));
    if (!title || junkOfficialTitle(title)) continue;
    const loc = stripTags(m[4] || "");
    const start = toIso(currentDate.y, currentDate.m, currentDate.d, m[3]);
    events.push(
      ev({
        sourceId: hashId("SC", start, title),
        state: "SC",
        title,
        start,
        location: loc,
        chamber: /chamber=S/i.test(pageUrl) ? "senate" : /chamber=H/i.test(pageUrl) ? "house" : chamberFromTitle(title, "joint"),
        url: pageUrl,
      }),
    );
  }
  return events.filter(usable);
}

async function fetchScMeetings(): Promise<CalendarEvent[]> {
  const urls: string[] = [];
  for (const chamber of ["H", "S", "B"]) {
    urls.push(`https://www.scstatehouse.gov/meetings.php?chamber=${chamber}`);
    for (let week = 1; week <= 6; week++) {
      urls.push(`https://www.scstatehouse.gov/meetings.php?chamber=${chamber}&archiveweek=${week}`);
    }
  }
  const pages = await mapPool(urls, 4, async (url) => {
    try {
      return parseScMeetings(await fetchText(url, 14000), url);
    } catch {
      return [] as CalendarEvent[];
    }
  });
  const byId = new Map<string, CalendarEvent>();
  for (const rows of pages) {
    for (const e of rows) {
      if (!byId.has(e.sourceId)) byId.set(e.sourceId, e);
    }
  }
  return [...byId.values()].filter(usable);
}

function parseNeHearings(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  let currentDate: { y: number; m: number; d: number } | null = parseHumanDate(
    stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""),
  );
  const tokenRe = /<h2[^>]*>([\s\S]*?)<\/h2>|class="card mb-4"[^>]*>([\s\S]*?)<table/gi;
  let token: RegExpExecArray | null;
  while ((token = tokenRe.exec(html))) {
    if (token[1] && token[2] === undefined) {
      currentDate = parseHumanDate(stripTags(token[1])) || currentDate;
      continue;
    }
    const card = token[2] || "";
    const title = cleanOfficialTitle(stripTags(card.match(/class="col-6"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || ""));
    const when = stripTags(card.match(/<small[^>]*>([\s\S]*?)<\/small>/i)?.[1] || card);
    if (!title || !currentDate || junkOfficialTitle(title)) continue;
    const time = clockTime(when.match(/\d{1,2}:\d{2}\s*[AP]M/i)?.[0] || "");
    const loc = when
      .replace(/location:\s*/i, "")
      .replace(/time:\s*\d{1,2}:\d{2}\s*[AP]M/i, "")
      .replace(/\d{1,2}:\d{2}\s*[AP]M/i, "")
      .replace(/\s*-\s*/g, " ")
      .trim();
    const start = toIso(currentDate.y, currentDate.m, currentDate.d, time);
    const id = hashId("NE", start, title);
    if (byId.has(id)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "NE",
        title,
        start,
        location: loc,
        chamber: "unicameral",
        url: pageUrl,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

async function fetchNeHearings(): Promise<CalendarEvent[]> {
  const from = new Date();
  from.setDate(from.getDate() - 7);
  const to = new Date();
  to.setMonth(to.getMonth() + 3);
  const stamp = (d: Date) => d.toISOString().slice(0, 10);
  const urls = [
    `https://nebraskalegislature.gov/calendar/hearings_range.php?start=${stamp(from)}&end=${stamp(to)}`,
    "https://nebraskalegislature.gov/calendar/hearings_range.php?weekly=this",
    "https://nebraskalegislature.gov/calendar/hearings_range.php?weekly=next",
    "https://nebraskalegislature.gov/calendar/",
  ];
  const pages = await mapPool(urls, 3, async (url) => {
    try {
      return parseNeHearings(await fetchText(url, 18000), url);
    } catch {
      return [] as CalendarEvent[];
    }
  });
  const byId = new Map<string, CalendarEvent>();
  for (const rows of pages) {
    for (const e of rows) {
      if (!byId.has(e.sourceId)) byId.set(e.sourceId, e);
    }
  }
  if (byId.size) return [...byId.values()].filter(usable);

  const cal = await fetchText("https://nebraskalegislature.gov/calendar/", 16000);
  const days = [...new Set([...cal.matchAll(/hearings\.php\?day=(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]))];
  const dayPages = await mapPool(days.slice(0, 20), 4, async (day) => {
    const url = `https://nebraskalegislature.gov/calendar/hearings.php?day=${day}`;
    try {
      return parseNeHearings(await fetchText(url, 14000), url);
    } catch {
      return [] as CalendarEvent[];
    }
  });
  for (const rows of dayPages) {
    for (const e of rows) {
      if (!byId.has(e.sourceId)) byId.set(e.sourceId, e);
    }
  }
  return [...byId.values()].filter(usable);
}

async function fetchMtEvents(): Promise<CalendarEvent[]> {
  const icsUrl = "https://www.legmt.gov/events/?ical=1";
  const rows = parseIcsText(await fetchText(icsUrl, 20000)).map((e) =>
    ev({
      ...e,
      sourceId: e.sourceId.startsWith("MT|") ? e.sourceId : `mt-${e.sourceId}`.slice(0, 180),
      state: "MT",
      title: e.title,
      start: e.start,
      location: e.location,
      url: e.url || "https://www.legmt.gov/events/",
      chamber: chamberFromTitle(e.title, "joint"),
    }),
  );
  if (rows.length) return rows.filter(usable);
  const data = await fetchJson<{ events?: Array<{ title?: string; start_date?: string; url?: string; venue?: { venue?: string } }> }>(
    "https://www.legmt.gov/wp-json/tribe/events/v1/events?per_page=50",
  );
  return (data.events || [])
    .map((row) => {
      const title = cleanOfficialTitle(row.title || "");
      const start = (row.start_date || "").replace(" ", "T");
      return ev({
        sourceId: hashId("MT", start, title),
        state: "MT",
        title,
        start,
        location: row.venue?.venue || "",
        url: row.url || icsUrl,
        chamber: chamberFromTitle(title, "joint"),
      });
    })
    .filter(usable);
}

type DeMeeting = {
  CommitteeMeetingId?: number;
  MeetingDateTime?: string;
  MeetingEndDateTime?: string;
  CommitteeMeetingStatusId?: number;
  CommitteeMeetingStatusName?: string;
  CommitteeName?: string;
  CommitteeTypeName?: string;
  CommitteeTypeShortCode?: string;
  AddressAliasNickname?: string;
  SharedWithCommitteeId?: number | null;
};

function parseDeJson(raw: string, pageUrl: string): CalendarEvent[] {
  let data: { Data?: DeMeeting[] };
  try {
    data = JSON.parse(raw) as { Data?: DeMeeting[] };
  } catch {
    return [];
  }
  return deRows(data.Data || [], pageUrl);
}

function deRows(rows: DeMeeting[], pageUrl: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const row of rows) {
    if (row.CommitteeMeetingStatusId === 2 || /cancel/i.test(row.CommitteeMeetingStatusName || "")) continue;
    const title = cleanOfficialTitle(row.CommitteeName || "");
    const when = row.MeetingDateTime || "";
    const parsed = parseLooseDate(when);
    if (!title || !parsed || junkOfficialTitle(title)) continue;
    const time = clockTime(when.match(/\d{1,2}:\d{2}\s*[AP]M/i)?.[0] || "");
    const start = toIso(parsed.y, parsed.m, parsed.d, time);
    const type = (row.CommitteeTypeShortCode || row.CommitteeTypeName || "").toLowerCase();
    const chamber = type.startsWith("s") ? "senate" : type.startsWith("h") ? "house" : "joint";
    const id = row.CommitteeMeetingId ? `de-${row.CommitteeMeetingId}` : hashId("DE", start, title);
    events.push(
      ev({
        sourceId: id,
        state: "DE",
        title,
        start,
        end: row.MeetingEndDateTime ? toIso(parsed.y, parsed.m, parsed.d, clockTime(row.MeetingEndDateTime.match(/\d{1,2}:\d{2}\s*[AP]M/i)?.[0] || "")) : undefined,
        location: row.AddressAliasNickname || "",
        chamber: row.SharedWithCommitteeId ? "joint" : chamber,
        url: row.CommitteeMeetingId
          ? `https://legis.delaware.gov/MeetingNotice?committeeMeetingId=${row.CommitteeMeetingId}`
          : pageUrl,
      }),
    );
  }
  return events.filter(usable);
}

async function fetchDeMeetings(): Promise<CalendarEvent[]> {
  const url = "https://legis.delaware.gov/json/CommitteeMeetings/GetUpcomingCommitteeMeetings";
  const raw = await fetchTextPost(url, "page=1&pageSize=200&take=200&skip=0", 18000, {
    Referer: "https://legis.delaware.gov/Meetings",
  });
  const data = JSON.parse(raw) as { Data?: DeMeeting[]; Errors?: unknown };
  if (Array.isArray(data.Errors) ? data.Errors.length : data.Errors) {
    throw new Error("Delaware meetings JSON returned errors");
  }
  return deRows(data.Data || [], "https://legis.delaware.gov/Meetings");
}

function parseTn(html: string, pageUrl: string): CalendarEvent[] {
  const byId = new Map<string, CalendarEvent>();
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html))) {
    if (/<th/i.test(row[1])) continue;
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripTags(c[1]));
    if (cells.length < 2) continue;
    const parsed = parseHumanDate(cells.join(" "));
    const title = cleanOfficialTitle(cells.find((c) => /committee|hearing|session|calendar/i.test(c) && !parseHumanDate(c)) || cells[1] || "");
    if (!parsed || !title || junkOfficialTitle(title) || /no records|no meetings/i.test(cells.join(" "))) continue;
    const time = clockTime(cells.join(" ").match(/\d{1,2}:\d{2}\s*[AP]M/i)?.[0] || "");
    const start = toIso(parsed.y, parsed.m, parsed.d, time);
    const id = hashId("TN", start, title);
    if (byId.has(id)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "TN",
        title,
        start,
        chamber: chamberFromTitle(title) || (/senate/i.test(pageUrl) ? "senate" : /house/i.test(pageUrl) ? "house" : ""),
        url: pageUrl,
      }),
    );
  }
  return [...byId.values()].filter(usable);
}

async function fetchTnSchedule(): Promise<CalendarEvent[]> {
  const urls = [
    "https://wapp.capitol.tn.gov/apps/Schedule/",
    "https://wapp.capitol.tn.gov/apps/Schedule/Default?type=house",
    "https://wapp.capitol.tn.gov/apps/Schedule/Default?type=senate",
    "https://wapp.capitol.tn.gov/apps/Schedule/Default?type=joint",
  ];
  const pages = await mapPool(urls, 2, async (url) => {
    try {
      return parseTn(await fetchText(url, 16000), url);
    } catch {
      return [] as CalendarEvent[];
    }
  });
  const byId = new Map<string, CalendarEvent>();
  for (const rows of pages) {
    for (const e of rows) {
      if (!byId.has(e.sourceId)) byId.set(e.sourceId, e);
    }
  }
  return [...byId.values()].filter(usable);
}

export async function fetchNdCalendar(): Promise<{ events: CalendarEvent[]; canceled: string[] }> {
  const url = "https://www.ndlegis.gov/calendar";
  const html = await fetchText(url, 25000);
  const byId = new Map<string, CalendarEvent>();
  const canceled: string[] = [];
  const blocks = html.split(/<div class="event-wrapper[^"]*">/i).slice(1);
  for (const block of blocks) {
    const chunk = block.slice(0, 2500);
    const title = cleanOfficialTitle(
      stripTags((chunk.match(/class="event-title"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i) || [])[1] || ""),
    );
    const href = (chunk.match(/href="([^"]+)"/) || [])[1] || "";
    const day = (href.match(/\/events\/(\d{4})\/(\d{2})\/(\d{2})\//) || []).slice(1, 4).join("-");
    if (title && day && /class="Canceled"/i.test(chunk)) {
      canceled.push(`${day}|${title.toLowerCase()}`);
      continue;
    }
    if (!title || junkOfficialTitle(title)) continue;
    const parsed = parseHumanDate(day);
    if (!parsed) continue;
    const time = (chunk.match(/class="event-date">\s*([^<]+)/i) || [])[1] || "";
    const start = toIso(parsed.y, parsed.m, parsed.d, time);
    const loc = stripTags((chunk.match(/class="event-location"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "").slice(0, 120);
    const id = hashId("ND", start, title);
    if (byId.has(id)) continue;
    byId.set(
      id,
      ev({
        sourceId: id,
        state: "ND",
        title,
        start,
        location: loc,
        chamber: "joint",
        url: href ? absUrl(url, href) : url,
      }),
    );
  }
  return { events: [...byId.values()].filter(usable), canceled };
}

type WyMeeting = {
  startDate?: string;
  startTime?: string;
  isPublic?: boolean;
  purpose?: string;
  address1?: string;
  city?: string;
  state?: string;
  sessionMeetingBills?: { billNumber?: string }[];
  committee?: { fullName?: string; displayName?: string; shortName?: string };
};

export async function fetchWyMeetings(): Promise<CalendarEvent[]> {
  const byId = new Map<string, CalendarEvent>();
  const stamps: string[] = [];
  const cursor = new Date();
  cursor.setDate(1);
  for (let i = 0; i < 4; i += 1) {
    stamps.push(
      `${cursor.getFullYear()}${String(cursor.getMonth() + 1).padStart(2, "0")}01`,
    );
    cursor.setMonth(cursor.getMonth() + 1);
  }
  for (const stamp of stamps) {
    let rows: WyMeeting[] = [];
    try {
      const payload = await fetchJson<WyMeeting[]>(
        `https://lsoservice.wyoleg.gov/api/v2/Calendar/Events/${stamp}`,
        25000,
      );
      rows = Array.isArray(payload) ? payload : [];
    } catch {
      continue;
    }
    for (const row of rows) {
      if (row.isPublic === false) continue;
      const title = cleanOfficialTitle(row.committee?.fullName || row.committee?.displayName || row.committee?.shortName || "");
      if (!title || junkOfficialTitle(title) || /holiday/i.test(title)) continue;
      const raw = String(row.startDate || "");
      const parsed = parseHumanDate(raw);
      if (!parsed) continue;
      const hasClock = /T(?!00:00:00)\d{2}:\d{2}/.test(raw);
      const start = hasClock ? raw.replace(/Z$/, "").slice(0, 19) : toIso(parsed.y, parsed.m, parsed.d, row.startTime || "");
      const id = hashId("WY", start, title);
      if (byId.has(id)) continue;
      const loc = [row.address1, row.city, row.state].filter(Boolean).join(", ");
      byId.set(
        id,
        ev({
          sourceId: id,
          state: "WY",
          title,
          start,
          location: loc,
          description: row.purpose || "",
          chamber: /joint|select/i.test(title) ? "joint" : /senate/i.test(title) ? "senate" : /house/i.test(title) ? "house" : "joint",
          url: "https://wyoleg.gov/Calendar",
          bills: (row.sessionMeetingBills || []).map((b) => String(b.billNumber || "")).filter(Boolean),
        }),
      );
    }
  }
  return [...byId.values()].filter(usable);
}

async function fetchWiCommitteeSchedule(): Promise<CalendarEvent[]> {
  const window = upcomingWindow();
  const html = await fetchText(
    `https://committeeschedule.legis.wisconsin.gov/?StartDate=${window.from}&CommitteeID=-1&CommItemVisibleName=-1&TopicID=-1&ViewType=listDay&ReloadCache=True`,
    40000,
  );
  return parseWiCommitteeSchedule(html, window);
}

function formatWiTitle(raw: string): string {
  const m = raw.match(/^(.*?)\s*\((Senate|Assembly|Joint|Legislative Council)\)\s*$/i);
  if (!m) return raw;
  const name = m[1].trim();
  const kind = m[2];
  if (/legislative council/i.test(kind)) return `${name} (Legislative Council)`;
  if (/joint/i.test(kind)) return `Joint Committee on ${name}`;
  if (/assembly/i.test(kind)) return `Assembly Committee on ${name}`;
  return `Senate Committee on ${name}`;
}

function wiChamber(classNames: string, title: string): string {
  const blob = `${classNames} ${title}`;
  if (/joint|legislativecouncil|legislative council/i.test(blob)) return "joint";
  if (/\bsenate\b/i.test(blob)) return "senate";
  if (/\bassembly\b/i.test(blob)) return "house";
  return "joint";
}

function parseWiCommitteeSchedule(html: string, window: { from: string; to: string }): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const seen = new Set<string>();
  const re =
    /title:\s*"((?:\\.|[^"\\])*)"\s*,\s*start:\s*'([^']+)'\s*,\s*description:\s*'((?:\\.|[^'\\])*)'\s*,\s*classNames:\s*'([^']*)'\s*,\s*url:\s*'([^']*)'/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const rawTitle = decodeEntities(m[1].replace(/\\"/g, '"')).replace(/\s+/g, " ").trim();
    const start = m[2];
    const description = decodeEntities(m[3]).replace(/\s+/g, " ").trim();
    const classNames = m[4];
    const url = m[5];
    const day = start.slice(0, 10);
    if (!rawTitle || !day || day < window.from || day > window.to) continue;
    if (/cancel/i.test(description)) continue;
    const title = formatWiTitle(rawTitle);
    const cid = (url.match(/\/cid\/(\d+)/i) || [])[1] || "";
    const sourceId = cid ? `WI|${cid}|${start}` : hashId("WI", start, title);
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    events.push(
      ev({
        sourceId,
        state: "WI",
        title,
        start,
        chamber: wiChamber(classNames, title),
        url,
        description,
      }),
    );
  }
  return events.filter(usable);
}

export async function fetchRssEvents(url: string, state: string): Promise<CalendarEvent[]> {
  const xml = await fetchText(url);
  const events: CalendarEvent[] = [];
  const items = xml.split(/<item[\s>]/i).slice(1);
  for (const item of items) {
    const title = stripTags(tag(item, "title"));
    const link = stripTags(tag(item, "link")) || url;
    const desc = stripTags(tag(item, "description"));
    const guid = stripTags(tag(item, "guid"));
    const dateText =
      (desc.match(/meeting date:\s*([^<\n]+)/i) || [])[1] ||
      (link.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//) || []).slice(1, 4).join("-") ||
      stripTags(tag(item, "pubDate")) ||
      stripTags(tag(item, "dc:date")) ||
      "";
    const parsed = parseHumanDate(dateText) || parseRssDate(dateText);
    if (!title || !parsed) continue;
    const start = toIso(parsed.y, parsed.m, parsed.d);
    events.push(
      ev({
        sourceId: guid ? `${state}-${guid}` : hashId(state, start, title),
        state,
        title,
        start,
        url: link,
        description: desc,
      }),
    );
  }
  return events.filter(usable);
}

async function fetchVaMeetings(): Promise<CalendarEvent[]> {
  const byId = new Map<string, CalendarEvent>();
  const window = upcomingWindow();
  try {
    const from = window.from;
    const to = window.to;
    const data = await fetchJson<Record<string, unknown>>(
      `https://lis.virginia.gov/Schedule/api/GetScheduleListAsync?startDate=${from}&endDate=${to}`,
      20000,
    );
    const rows = Array.isArray(data)
      ? data
      : Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.data)
          ? data.data
          : [];
    for (const row of rows as {
      title?: string;
      start?: string;
      location?: string;
      ownerName?: string;
      isCancelled?: boolean;
      StartDate?: string;
      OwnerName?: string;
      Title?: string;
    }[]) {
      if (row.isCancelled) continue;
      const title = String(row.title || row.Title || row.ownerName || row.OwnerName || "").trim();
      const start = String(row.start || row.StartDate || "");
      if (!title || !start) continue;
      const id = hashId("VA", start, title);
      if (byId.has(id)) continue;
      byId.set(
        id,
        ev({
          sourceId: id,
          state: "VA",
          title,
          start,
          location: row.location || "",
          url: "https://lis.virginia.gov/Meeting/Calendar",
        }),
      );
    }
  } catch {
    /* LIS schedule API needs a key */
  }

  return [...byId.values()].filter(usable);
}

export function stateFromOfficialUrl(pageUrl: string): string | null {
  let host = "";
  try {
    host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  for (const src of STATE_SOURCES) {
    const urls = [src.officialUrl, ...src.feeds.map((f) => f.url)];
    for (const u of urls) {
      try {
        const h = new URL(u).hostname.toLowerCase().replace(/^www\./, "");
        if (h === host || host.endsWith(`.${h}`) || h.endsWith(`.${host}`)) return src.code;
      } catch {
        /* skip bad url */
      }
    }
  }
  return null;
}
