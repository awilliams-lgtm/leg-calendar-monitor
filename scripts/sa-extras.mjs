import { readFileSync, writeFileSync } from "fs";

const MONTH = "2026-09";
const THRESHOLD = 0.58;

const STOP = new Set(
  "the a an of and or to in on for at by with from hearing hearings meeting meetings committee committees commission subcommittee joint session floor calendar notice public special".split(
    " ",
  ),
);
const WEAK = new Set(["assembly", "senate", "house", "legislature"]);
const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

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

function hidden(input) {
  const title = `${input?.title || ""} ${input?.description || ""}`;
  if (/[\[(]\s*hidden\s*[\])]/i.test(title) || /\bhidden\s*[-–—:]/i.test(title)) return true;
  const bags = [input, input?.raw].filter((x) => x && typeof x === "object");
  for (const bag of bags) {
    for (const key of ["hidden", "is_hidden", "isHidden", "hide", "unpublished", "unlisted"]) {
      if (bag[key] === true || bag[key] === 1 || String(bag[key] || "").toLowerCase() === "true") return true;
    }
    const status = String(bag.status || bag.visibility || "").toLowerCase();
    if (status === "hidden" || status === "unpublished" || status === "unlisted") return true;
  }
  return false;
}

function junk(title) {
  const t = (title || "").toLowerCase();
  if (!title || title.length < 4 || title.length > 180) return true;
  if (/no meetings scheduled|no events scheduled|cookie|javascript|skip to|sign in/.test(t)) return true;
  return false;
}

const officialCache = JSON.parse(readFileSync("data/official-cache.json", "utf8"));
const saCache = JSON.parse(readFileSync("data/sa-meetings-cache.json", "utf8"));

const official = (officialCache.events || []).filter(
  (e) => e.start?.slice(0, 7) === MONTH && e.title && e.start && !junk(e.title) && !hidden(e),
);
const sa = (saCache.events || []).filter((e) => e.start?.slice(0, 7) === MONTH && e.title && e.start && !hidden(e));

const officialByState = new Map();
for (const ev of official) {
  const list = officialByState.get(ev.state) || [];
  list.push(ev);
  officialByState.set(ev.state, list);
}
const saByState = new Map();
for (const ev of sa) {
  const list = saByState.get(ev.state) || [];
  list.push(ev);
  saByState.set(ev.state, list);
}

const usedOfficial = new Set();
const extras = [];
const matchedSa = [];

for (const ev of sa) {
  const cands = officialByState.get(ev.state) || [];
  let best = { score: 0, title: "", start: "", idx: -1 };
  for (let i = 0; i < cands.length; i += 1) {
    if (usedOfficial.has(`${ev.state}|${i}`)) continue;
    const score = scorePair(cands[i], ev);
    if (score > best.score) best = { score, title: cands[i].title, start: cands[i].start, idx: i };
  }
  if (best.score >= THRESHOLD && best.idx >= 0) {
    usedOfficial.add(`${ev.state}|${best.idx}`);
    matchedSa.push(ev);
  } else {
    extras.push({
      state: ev.state,
      title: ev.title,
      start: ev.start.slice(0, 10),
      chamber: ev.chamber || "",
      location: ev.location || "",
      url: ev.url || "",
      bestScore: Number(best.score.toFixed(2)),
      bestOfficial: best.title,
      officialSameDay: (officialByState.get(ev.state) || []).filter((o) => o.start.slice(0, 10) === ev.start.slice(0, 10))
        .length,
    });
  }
}

const states = [...new Set([...officialByState.keys(), ...saByState.keys()])].sort();
const rows = states
  .map((code) => {
    const off = officialByState.get(code) || [];
    const listed = saByState.get(code) || [];
    const extra = extras.filter((e) => e.state === code);
    const extraNoDay = extra.filter((e) => e.officialSameDay === 0);
    const extraSameDay = extra.filter((e) => e.officialSameDay > 0);
    return {
      code,
      official: off.length,
      sa: listed.length,
      extra: extra.length,
      extraNoDay: extraNoDay.length,
      extraSameDay: extraSameDay.length,
      surplus: listed.length - off.length,
    };
  })
  .filter((r) => r.sa || r.official)
  .sort((a, b) => b.extra - a.extra || b.surplus - a.surplus);

const noOfficial = rows.filter((r) => r.official === 0 && r.sa > 0);
const surplus = rows.filter((r) => r.surplus > 0);
const extraNoDay = extras.filter((e) => e.officialSameDay === 0);
const extraSameDay = extras.filter((e) => e.officialSameDay > 0);

function samples(list, n = 4) {
  return list.slice(0, n).map((e) => `${e.start} ${e.title}`);
}

const payload = {
  official: official.length,
  sa: sa.length,
  matched: matchedSa.length,
  extraSa: extras.length,
  extraNoDay: extraNoDay.length,
  extraSameDay: extraSameDay.length,
  statesNoOfficial: noOfficial,
  surplusStates: surplus,
  rows: rows.filter((r) => r.extra > 0),
  samplesByState: Object.fromEntries(
    rows
      .filter((r) => r.extra > 0)
      .slice(0, 20)
      .map((r) => [
        r.code,
        extras
          .filter((e) => e.state === r.code)
          .slice(0, 8)
          .map((e) => ({
            start: e.start,
            title: e.title,
            chamber: e.chamber,
            officialSameDay: e.officialSameDay,
            bestOfficial: e.bestOfficial,
            bestScore: e.bestScore,
          })),
      ]),
  ),
  officialNotes: officialCache.notes || {},
  lastPulled: officialCache.lastPulled || {},
};

function category(title) {
  const t = (title || "").toLowerCase();
  if (/fundrais|reception|breakfast|lunch|dinner|campaign|candidate|pac\b|newsmaker/.test(t)) {
    return "fundraiser/campaign";
  }
  if (/museum|grito|save the|capitol museum|come to the table|bell ringing|advocacy volunteer/.test(t)) {
    return "museum/advocacy";
  }
  if (/filing|report|deadline|can begin/.test(t)) return "deadline/admin";
  if (
    /board of|commission|advisory|council|task force|occupational|pharmacy|medicine|liquor|dpi|dhhs|wsi|real estate|affordability|prescription drug|accountancy|unemployment|administrative board|state board|psc hearing/.test(
      t,
    )
  ) {
    return "executive/board";
  }
  if (/floor session|house session|senate session|informal house/.test(t)) return "floor session";
  if (/cancel/.test(t)) return "cancelled";
  return "legislative/other";
}

const cats = {};
const catsByState = {};
for (const e of extras) {
  const c = category(e.title);
  cats[c] = (cats[c] || 0) + 1;
  catsByState[e.state] ||= {};
  catsByState[e.state][c] = (catsByState[e.state][c] || 0) + 1;
}
payload.categories = cats;
payload.categoriesByState = catsByState;
payload.legislativeExtras = extras
  .filter((e) => category(e.title) === "legislative/other")
  .map((e) => ({ state: e.state, start: e.start, title: e.title, officialSameDay: e.officialSameDay }));

writeFileSync("data/sa-extras.json", JSON.stringify(payload, null, 2));

console.log(`official ${official.length} sa ${sa.length} matched ${matchedSa.length} extraSA ${extras.length}`);
console.log(`extra with no official that day ${extraNoDay.length}`);
console.log(`extra with official same day (title miss) ${extraSameDay.length}`);
console.log("\nSA surplus (SA > official)");
for (const r of surplus) {
  console.log(
    `${r.code} official ${r.official} sa ${r.sa} surplus ${r.surplus} unmatchedSA ${r.extra} (no-day ${r.extraNoDay} same-day ${r.extraSameDay})`,
  );
}
console.log("\nNo official September rows, but SA has meetings");
for (const r of noOfficial) console.log(`${r.code} sa ${r.sa}`);
console.log("\ncategories", JSON.stringify(cats));
console.log("legislative extras", payload.legislativeExtras.length);
for (const e of payload.legislativeExtras.slice(0, 40)) {
  console.log(`  ${e.state} ${e.start} ${e.title}`);
}

console.log("\nTop unmatched SA states");
for (const r of rows.filter((x) => x.extra > 0).slice(0, 18)) {
  console.log(`${r.code} official ${r.official} sa ${r.sa} extra ${r.extra}`);
  for (const s of samples(extras.filter((e) => e.state === r.code), 3)) console.log(`  ${s}`);
}
