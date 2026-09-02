import { readFileSync } from "fs";

const official = JSON.parse(readFileSync("data/official-cache.json", "utf8"));
const sa = JSON.parse(readFileSync("data/sa-meetings-cache.json", "utf8"));
const month = "2026-09";

function inMonth(e) {
  return String(e.start || "").slice(0, 7) === month;
}

const off = (official.events || []).filter(inMonth);
const saEv = (sa.events || []).filter(inMonth);

const by = new Map();
for (const e of off) {
  const row = by.get(e.state) || { official: 0, sa: 0, offTitles: [], saTitles: [] };
  row.official += 1;
  if (row.offTitles.length < 8) row.offTitles.push(`${e.start.slice(0, 10)} ${e.title}`);
  by.set(e.state, row);
}
for (const e of saEv) {
  const row = by.get(e.state) || { official: 0, sa: 0, offTitles: [], saTitles: [] };
  row.sa += 1;
  if (row.saTitles.length < 8) row.saTitles.push(`${e.start.slice(0, 10)} ${e.title}`);
  by.set(e.state, row);
}

const rows = [...by.entries()]
  .map(([state, r]) => ({ state, ...r, delta: r.sa - r.official }))
  .sort((a, b) => b.delta - a.delta);

const saAhead = rows.filter((r) => r.delta > 0);
const offAhead = rows.filter((r) => r.delta < 0);
console.log(
  JSON.stringify(
    {
      officialSep: off.length,
      saSep: saEv.length,
      officialAll: (official.events || []).length,
      saAll: (sa.events || []).length,
      saMinusOfficial: saEv.length - off.length,
      statesSaAhead: saAhead.map((r) => `${r.state} SA ${r.sa} off ${r.official} (+${r.delta})`),
      statesOffAhead: offAhead.map((r) => `${r.state} SA ${r.sa} off ${r.official} (${r.delta})`),
      extras: saAhead.map((r) => ({
        state: r.state,
        official: r.official,
        sa: r.sa,
        delta: r.delta,
        officialSample: r.offTitles,
        saSample: r.saTitles,
      })),
    },
    null,
    2,
  ),
);
