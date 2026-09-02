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
  return t.slice(0, 140).trim();
}

export function withChamberLabel(title: string, label: "Assembly" | "Senate" | ""): string {
  const t = title.trim();
  if (!t || !label) return t;
  if (new RegExp(`\\b${label}\\b`, "i").test(t)) return t;
  return `${label} ${t}`;
}

export function junkOfficialTitle(title: string): boolean {
  const t = (title || "").toLowerCase();
  if (title.length < 4 || title.length > 180) return true;
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

export function usableOfficialEvents<T extends { title: string; start?: string; description?: string; raw?: unknown }>(
  events: T[],
): T[] {
  return events.filter(
    (e) => Boolean(e.title && e.start) && !junkOfficialTitle(e.title) && !isHiddenMeeting(e),
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
