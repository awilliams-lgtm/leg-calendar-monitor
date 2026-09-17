import { isHiddenMeeting } from "@/lib/hidden";
import { decodeEntities } from "@/lib/html";

const CHROME =
  /\b(add to calendar|view agenda|view details|view more|watch live|listen live|live broadcast(?:\s*-\s*audio only)?|printer friendly|agenda available|download ics|opens?\s+in\s+a\s+new\s+tab|click here)\b/gi;

const SMALL = new Set(["and", "or", "of", "the", "to", "in", "on", "for", "a", "an", "at", "by"]);

export function cleanOfficialTitle(raw: string): string {
  let t = decodeEntities(String(raw || ""));
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(CHROME, " ");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/^[-–—:|,.\s]+|[-–—:|,.\s]+$/g, "");
  if (isMostlyCaps(t)) t = titleCaseName(t);
  else t = softenSmallWords(t);
  return t.slice(0, 180).trim();
}

export function withChamberLabel(title: string, label: "Assembly" | "Senate" | "House" | ""): string {
  const t = title.trim();
  if (!t || !label) return t;
  if (new RegExp(`\\b${label}\\b`, "i").test(t)) return t;
  if (label === "House" && /\bassembly\b/i.test(t)) return t;
  return `${label} ${t}`;
}

/** True when the title is only a chamber + category, e.g. "Senate Standing Committee". */
export function isGenericCommitteeLabel(title: string): boolean {
  return /^(house|senate|joint|assembly)\s+(standing|special|conference|other)(\s+committees?)?$/i.test(
    title.trim(),
  );
}

/**
 * Office/building/holiday closures. Closed-door briefings and hearings stay.
 */
export function isClosedFacilityNotice(title: string): boolean {
  const t = String(title || "")
    .toLowerCase()
    .replace(/[:–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  if (
    /\b(closed briefing|closed hearing|closed session|closed[- ]door|meet in closed|in closed session)\b/.test(
      t,
    )
  ) {
    return false;
  }
  if (
    /\b(offices?|buildings?|capitol|chambers?|facilit(?:y|ies)|statehouse|state house)\s+closed\b/.test(t)
  ) {
    return true;
  }
  if (/\bclosed\s+(offices?|buildings?|capitol|chambers?|facilit(?:y|ies))\b/.test(t)) return true;
  if (/^(state\s+)?(offices?\s+)?closed$/.test(t)) return true;
  if (/\b(state|observed|federal|legal)\s+holiday\b/.test(t) && /\bclosed\b/.test(t)) return true;
  if (/^(state|observed|federal)\s+holiday$/.test(t)) return true;
  return false;
}

export function junkOfficialTitle(title: string): boolean {
  const t = (title || "").toLowerCase();
  if (title.length < 4 || title.length > 220) return true;
  if (/^[^a-z]{0,3}$/i.test(title.trim())) return true;
  if (/<\/?[a-z]|href=|&lt;|&gt;/.test(t)) return true;
  if (
    /cookie|javascript|skip to|sign in|log in|copyright|privacy|subscribe|select a|menu|search the/.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /no meetings scheduled|no events scheduled|no meetings have been scheduled|there are no events|no results were found|there were no results found|please choose another date/.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /an act relating to|unfinished business|inactive file|vote required|concurrence in senate|motions to reconsider/.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /assembly journal|previous week|current next week|schedule type|week of printer|this month this week|today's schedule|view live feed/.test(
      t,
    )
  ) {
    return true;
  }
  if (/month january|february \d{4} march \d{4}|disclaimer \* policies/.test(t)) return true;
  if (/legislative services agency|scheduled for live broadcast|upcoming events \(\d+\)/.test(t)) {
    return true;
  }
  if (/\(1 event\)|●/.test(title)) return true;
  if ((title.match(/\bRoom\b/g) || []).length >= 2) return true;
  if (/\badd to calendar\b|\bview agenda\b/.test(t)) return true;
  if (/upon call of the chair/.test(t) && /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(t)) return true;
  if (/^\d{1,2}:\d{2}/.test(title) && /\bstream\b/.test(t)) return true;
  if (/^bill no\.?$|^author$|^committee name$|^house$|^senate$|^assembly$/.test(t)) return true;
  if (/^start time\b/.test(t)) return true;
  if (/committee group\s*\([a-z]\)\s*scheduled to meet/i.test(t)) return true;
  if (/^(senate|assembly|house)\s+chambers$/i.test(t)) return true;
  if (isClosedFacilityNotice(title)) return true;
  if (/\b(examining board|board of (licensure|registration|accountancy|examiners|pharmacy|funeral|nursing|occupational therapy)|professional licensing|osteopathic licensure|social worker licensure)\b/.test(t)) {
    return true;
  }
  if (/\b(press conference|media availability|parade|breakfast|ribbon[- ]cutting)\b/.test(t)) return true;
  if (/^dls commission$/i.test(t)) return true;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}\s+meeting summary$/i.test(t)) return true;
  if (/^committee on .+\s-\s\d{4}-\d{2}-\d{2}$/i.test(title.trim())) return true;
  if (/study meeting on \d{1,2}\/\d{1,2}\/\d{2,4}\s*-\s*\d{4}-\d{2}-\d{2}$/i.test(t)) return true;
  const monthHits =
    title.match(
      /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d{1,2}\b/gi,
    ) || [];
  if (monthHits.length >= 2) return true;
  if (
    /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Open States / LIS often cuts a joint-meeting title at "and" and puts the rest in location.
 * Rejoin those so "House Agriculture and" matches the full SA title.
 */
export function completeOfficialTitle(title: string, location = "", description = ""): string {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  if (!/\band(?:\s+the)?$/i.test(t)) return t;
  const extra = `${location || ""}\n${description || ""}`
    .split(/\n/)
    .map((s) => s.trim())
    .find((s) => {
      if (!s || /^\(/.test(s)) return false;
      if (/^(committee info|agenda|view meeting|register to speak)/i.test(s)) return false;
      return (
        /\b(committee|commission|subcommittee|retreat|council|task force|workgroup|working group)\b/i.test(s) ||
        s.length >= 16
      );
    });
  if (!extra) return t;
  const piece = extra.replace(/^and\s+/i, "").replace(/\s+/g, " ").trim();
  if (piece.length < 8) return t;
  return `${t} ${piece}`.replace(/\s+/g, " ").trim().slice(0, 220);
}

export function junkOfficialEvent(e: {
  title: string;
  start?: string;
  description?: string;
  raw?: unknown;
  url?: string;
  state?: string;
}): boolean {
  if (!e.title || !e.start) return true;
  if (junkOfficialTitle(e.title)) return true;
  if (isHiddenMeeting(e)) return true;
  const url = String(e.url || "");
  if ((e.state === "WI" || /wisconsin/i.test(url)) && /\/(?:20\d{2}\/)?related\/hearings\b/i.test(url)) {
    return true;
  }
  if (e.state === "WI" && / - \d{4}-\d{2}-\d{2}$/.test(e.title.trim())) return true;
  if (e.state === "ME" && /board of (trustees|directors)|state board of/i.test(e.title) && !/\b(committee|legislature|house|senate)\b/i.test(e.title)) {
    return true;
  }
  if (e.state === "FL" && /VideoPlayer\.aspx/i.test(url) && !/MeetingId=/i.test(url)) return true;
  if (e.state === "FL" && /houseschedule\.aspx/i.test(url) && /^start time\b/i.test(e.title)) return true;
  if (/dls\.virginia\.gov\/commissions\.html/i.test(url)) return true;
  if (/^https?:\/\/(?:www\.)?jlarc\.virginia\.gov\/?(?:meetings\.asp)?$/i.test(url)) return true;
  if (/foiacouncil\.dls\.virginia\.gov\/meetings\.htm/i.test(url)) return true;
  return false;
}

export function usableOfficialEvents<T extends {
  title: string;
  start?: string;
  location?: string;
  description?: string;
  raw?: unknown;
  url?: string;
  state?: string;
}>(events: T[]): T[] {
  return (events || [])
    .map((e) => {
      const title = completeOfficialTitle(e.title, e.location, e.description);
      return title === e.title ? e : { ...e, title };
    })
    .filter((e) => !junkOfficialEvent(e));
}

export function usableSaEvents<T extends { title?: string; start?: string }>(events: T[]): T[] {
  return (events || []).filter(
    (e) => Boolean(e.title && e.start) && !isClosedFacilityNotice(e.title || "") && !isHiddenMeeting(e),
  );
}

function isMostlyCaps(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 4) return false;
  const caps = letters.replace(/[^A-Z]/g, "").length;
  return caps / letters.length >= 0.7;
}

function titleCaseName(text: string): string {
  return text
    .split(/\s+/)
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i > 0 && SMALL.has(lower)) return lower;
      if (!/[a-z]/i.test(word)) return word;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function softenSmallWords(text: string): string {
  return text
    .split(/\s+/)
    .map((word, i) => {
      if (i === 0) return word;
      const lower = word.toLowerCase();
      return SMALL.has(lower) ? lower : word;
    })
    .join(" ");
}
