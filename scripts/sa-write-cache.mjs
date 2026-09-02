import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const cap = JSON.parse(readFileSync(path.join(root, "data", "sa-meetings-captured.json"), "utf8"));
const events = [];
const scraped = new Set();
for (const row of cap.rows || []) {
  const state = String(row.state?.state_abbr || "").toUpperCase();
  const id = String(row.meeting_id || "");
  const raw = String(row.event_date || "");
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  let date = "";
  if (iso) date = iso[1];
  else if (mdy) {
    const y = mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3];
    date = `${y}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  }
  if (!state || state === "US" || !id || !date) continue;
  scraped.add(state);
  events.push({
    sourceId: id,
    state,
    title: row.event_title || "Untitled meeting",
    start: `${date}T00:00:00`,
    location: row.event_location || "",
    chamber: "",
    url: "",
    bills: [],
    description: row.event_description || "",
  });
}
writeFileSync(
  path.join(root, "data", "sa-meetings-cache.json"),
  JSON.stringify({
    updatedAt: new Date().toISOString(),
    scraping: false,
    scraped: [...scraped].sort(),
    events,
    needsBrowserFetch: false,
    error: "",
  }),
);
console.log(JSON.stringify({ cached: events.length, states: scraped.size, from: cap.from, to: cap.to }));
