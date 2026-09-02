import { readFileSync, writeFileSync } from "fs";

const STOP = new Set(
  "the a an of and or to in on for at by with from hearing hearings meeting meetings committee committees commission subcommittee joint session floor calendar notice public special".split(
    " ",
  ),
);
const WEAK = new Set(["assembly", "senate", "house", "legislature"]);
const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

function forMatch(text) {
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

function tokens(text) {
  return new Set(
    forMatch(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

function dice(a, b) {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return (2 * inter) / (a.size + b.size);
}

function titleScore(officialTitle, saTitle) {
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

function chamberNorm(value) {
  const v = (value || "").toLowerCase();
  if (v.includes("house") || v === "h" || v.includes("assembly")) return "house";
  if (v.includes("senate") || v === "s") return "senate";
  if (v.includes("joint")) return "joint";
  return "";
}

function eventDateKey(iso) {
  const d = (iso || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
}

function scorePair(official, sa) {
  const d1 = eventDateKey(official.start);
  const d2 = eventDateKey(sa.start);
  if (!d1 || !d2 || d1 !== d2) return 0;
  const c1 = chamberNorm(official.chamber || "");
  const c2 = chamberNorm(sa.chamber || "");
  const chamberOk = !c1 || !c2 || c1 === c2;
  let score = titleScore(official.title, sa.title);
  if (!chamberOk) score *= 0.7;
  return score;
}

function containScore(a, b) {
  const A = [...tokens(a)].filter((w) => !WEAK.has(w));
  const B = [...tokens(b)].filter((w) => !WEAK.has(w));
  if (!A.length || !B.length) return 0;
  const setA = new Set(A);
  const setB = new Set(B);
  const smaller = A.length <= B.length ? setA : setB;
  const larger = A.length <= B.length ? setB : setA;
  let hit = 0;
  for (const x of smaller) if (larger.has(x)) hit += 1;
  return hit / smaller.size;
}

function shiftDay(iso, days) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function hidden(ev) {
  const t = `${ev.title || ""} ${ev.description || ""}`;
  if (/[\[(]\s*hidden\s*[\])]/i.test(t)) return true;
  const raw = ev.raw || {};
  return raw.hidden === true || raw.is_hidden === true || String(raw.status || "").toLowerCase() === "hidden";
}

const official = JSON.parse(readFileSync("data/official-cache.json", "utf8"));
const sa = JSON.parse(readFileSync("data/sa-meetings-cache.json", "utf8"));
const month = "2026-09";
const off = (official.events || []).filter((e) => e.state && e.start && e.start.startsWith(month) && e.title);
const saAll = (sa.events || []).filter((e) => e.state && e.start && e.start.startsWith(month) && e.title && !hidden(e));
const saByState = new Map();
for (const e of saAll) {
  const list = saByState.get(e.state) || [];
  list.push(e);
  saByState.set(e.state, list);
}

let matched = 0;
const misses = [];
for (const ev of off) {
  const pool = saByState.get(ev.state) || [];
  let best = { score: 0, title: "", start: "", contain: 0, offBy: null };
  for (const row of pool) {
    const score = scorePair(ev, row);
    const contain = eventDateKey(ev.start) === eventDateKey(row.start) ? containScore(ev.title, row.title) : 0;
    if (score > best.score) best = { score, title: row.title, start: row.start, contain, offBy: 0 };
  }
  if (best.score < 0.58) {
    for (const delta of [-1, 1]) {
      const day = shiftDay(ev.start, delta);
      for (const row of pool) {
        if (eventDateKey(row.start) !== day) continue;
        const contain = containScore(ev.title, row.title);
        const score = titleScore(ev.title, row.title);
        if (contain >= 0.8 || score >= 0.5) {
          if (contain > (best.offContain || 0) || score > (best.offScore || 0)) {
            best.offBy = delta;
            best.offTitle = row.title;
            best.offStart = row.start;
            best.offContain = contain;
            best.offScore = score;
          }
        }
      }
    }
    for (const row of pool) {
      if (eventDateKey(ev.start) !== eventDateKey(row.start)) continue;
      const contain = containScore(ev.title, row.title);
      if (contain > best.contain) {
        best.contain = contain;
        best.containTitle = row.title;
      }
    }
  }
  if (best.score >= 0.58) matched += 1;
  else misses.push({ ev, best });
}

const near = misses
  .filter((m) => m.best.score >= 0.35 || m.best.contain >= 0.7 || (m.best.offContain || 0) >= 0.7)
  .sort((a, b) => (b.best.score || b.best.contain || 0) - (a.best.score || a.best.contain || 0));

const byState = {};
for (const ev of off) {
  byState[ev.state] ||= { official: 0, missing: 0 };
  byState[ev.state].official += 1;
}
for (const m of misses) byState[m.ev.state].missing += 1;

console.log("official sept", off.length, "sa sept visible", saAll.length, "matched", matched, "missing", misses.length);
console.log("rate", ((matched / off.length) * 100).toFixed(1) + "%");
console.log("\nworst states");
Object.entries(byState)
  .sort((a, b) => b[1].missing - a[1].missing)
  .slice(0, 15)
  .forEach(([st, v]) => console.log(st, "official", v.official, "missing", v.missing, "onSA", v.official - v.missing));

console.log("\nNEAR MISSES same-day score/contain", near.length);
near.slice(0, 60).forEach((m) => {
  console.log(
    `${m.ev.state} ${m.ev.start.slice(0, 10)} score=${m.best.score.toFixed(2)} contain=${(m.best.contain || 0).toFixed(2)}${m.best.offBy ? ` off=${m.best.offBy}` : ""}`,
  );
  console.log("  OFF", m.ev.title);
  console.log("  SA ", m.best.containTitle || m.best.title || m.best.offTitle || "(none same day)");
  if (m.best.offTitle) console.log("  +/-", m.best.offStart?.slice(0, 10), m.best.offTitle, "c=" + (m.best.offContain || 0).toFixed(2));
});

const noSameDay = misses.filter((m) => !m.best.title && !m.best.containTitle);
const withSameDayLow = misses.filter((m) => (m.best.title || m.best.containTitle) && m.best.score < 0.58);
console.log("\nmissing with same-day SA candidate", withSameDayLow.length);
console.log("missing with no same-day SA", noSameDay.length);
console.log("off-by-one candidates", misses.filter((m) => (m.best.offContain || 0) >= 0.7).length);

writeFileSync(
  "data/title-near-miss.json",
  JSON.stringify(
    {
      official: off.length,
      sa: saAll.length,
      matched,
      missing: misses.length,
      near: near.slice(0, 80).map((m) => ({
        state: m.ev.state,
        day: m.ev.start.slice(0, 10),
        official: m.ev.title,
        sa: m.best.containTitle || m.best.title || m.best.offTitle || "",
        score: Number(m.best.score.toFixed(3)),
        contain: Number((m.best.contain || 0).toFixed(3)),
        offBy: m.best.offBy,
        offTitle: m.best.offTitle || "",
      })),
    },
    null,
    2,
  ),
);
