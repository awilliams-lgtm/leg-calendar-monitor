const BILL_RE = /\b(AB|SB|HB|HR|SR|AJR|SJR|SCR|HCR|HJR|LB|LD|HF|SF|H|S)\s*\.?\s*(\d{1,5})\b/gi;

const STOP = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "or",
  "to",
  "in",
  "on",
  "for",
  "at",
  "by",
  "with",
  "from",
  "hearing",
  "hearings",
  "meeting",
  "meetings",
  "committee",
  "committees",
  "commission",
  "subcommittee",
  "joint",
  "session",
  "floor",
  "calendar",
  "notice",
  "public",
  "special",
]);

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

const WEAK = new Set(["assembly", "senate", "house", "legislature"]);

export function extractBills(text: string): string[] {
  const found = new Set<string>();
  const src = text || "";
  const add = (kind: string, num: string) => {
    const k = String(kind || "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
    if (k && num) found.add(`${k} ${num}`);
  };
  src.replace(/\bH\.?\s*R\.?\s*(\d{1,5})\b/gi, (_m, num: string) => {
    add("HR", num);
    return "";
  });
  src.replace(/\bS\.?\s*B\.?\s*(\d{1,5})\b/gi, (_m, num: string) => {
    add("SB", num);
    return "";
  });
  src.replace(/\bH\.?\s*B\.?\s*(\d{1,5})\b/gi, (_m, num: string) => {
    add("HB", num);
    return "";
  });
  src.replace(/\bS\.\s+(\d{1,5})\b/g, (_m, num: string) => {
    add("S", num);
    return "";
  });
  src.replace(BILL_RE, (_m, kind: string, num: string) => {
    add(kind, num);
    return "";
  });
  return [...found].sort();
}

export function eventDateKey(iso: string): string {
  const d = (iso || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
}

function forMatch(text: string): string {
  return (text || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/opens?\s+in\s+a\s+new\s+tab/gi, " ")
    .replace(/\bto attend virtually\b[\s\S]*/gi, " ")
    .replace(/\bvia zoom\b[\s\S]*/gi, " ")
    .replace(/\bvoting meeting on\b.*$/gi, " ")
    .replace(/\band any other business\b.*$/gi, " ")
    .replace(/,\s*(rep\.|sen\.|representative|senator|chairman|chairperson)\b.*$/gi, " ")
    .replace(/\bpart\s+\d+\b/gi, " ")
    .replace(new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, "gi"), " ")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\b(?:full committee|bill hearing|voting session|work session|standing)\b/gi, " ");
}

function tokens(text: string): Set<string> {
  return new Set(
    forMatch(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return (2 * inter) / (a.size + b.size);
}

function titleScore(officialTitle: string, saTitle: string): number {
  const a = tokens(officialTitle);
  const b = tokens(saTitle);
  let score = dice(a, b);
  const coreA = new Set([...a].filter((w) => !WEAK.has(w)));
  const coreB = new Set([...b].filter((w) => !WEAK.has(w)));
  const smaller = coreA.size <= coreB.size ? coreA : coreB;
  const larger = coreA.size <= coreB.size ? coreB : coreA;
  let hit = 0;
  for (const x of smaller) if (larger.has(x)) hit += 1;
  if (smaller.size >= 2 && hit === smaller.size) score = Math.max(score, 0.82);
  if (smaller.size === 1 && hit === 1) {
    const only = [...smaller][0] || "";
    if (only.length >= 8) score = Math.max(score, 0.8);
  }
  return score;
}

function chamberNorm(value: string): string {
  const v = (value || "").toLowerCase();
  if (v.includes("house") || v === "h" || v.includes("assembly")) return "house";
  if (v.includes("senate") || v === "s") return "senate";
  if (v.includes("joint")) return "joint";
  return "";
}

export type Matchable = {
  title: string;
  start: string;
  chamber?: string;
  bills?: string[];
};

export type MatchResult = { score: number; title: string };

/** Score an official event against one SA event. 1 = same event. */
export function scorePair(official: Matchable, sa: Matchable): number {
  const d1 = eventDateKey(official.start);
  const d2 = eventDateKey(sa.start);
  if (!d1 || !d2 || d1 !== d2) return 0;

  const billsA = official.bills?.length ? official.bills : extractBills(official.title);
  const billsB = sa.bills?.length ? sa.bills : extractBills(sa.title);
  const billHit = billsA.some((b) => billsB.includes(b));

  const c1 = chamberNorm(official.chamber || "");
  const c2 = chamberNorm(sa.chamber || "");
  const chamberOk = !c1 || !c2 || c1 === c2;

  let score = titleScore(official.title, sa.title);
  if (billHit) score = Math.max(score, 0.86);
  if (!chamberOk) score *= 0.7;
  return score;
}

export function bestMatch(official: Matchable, saEvents: Matchable[]): MatchResult {
  let best: MatchResult = { score: 0, title: "" };
  for (const sa of saEvents) {
    const score = scorePair(official, sa);
    if (score > best.score) best = { score, title: sa.title };
  }
  return best;
}

export const MATCH_THRESHOLD = 0.58;
