import { readFileSync } from "fs";

function peek(name, extra = []) {
  const h = readFileSync(`data/probe-${name}`, "utf8");
  console.log(`\n======== ${name} ${h.length} ========`);
  console.log("head", h.slice(0, 180).replace(/\s+/g, " "));
  for (const k of ["September", "2026-09", "committee", "interim", "meeting", "api/", "ng-app", "calendar"]) {
    const n = (h.match(new RegExp(k, "gi")) || []).length;
    if (n) console.log(`  ${k}: ${n}`);
  }
  for (const pat of extra) {
    const m = h.match(new RegExp(pat, "i"));
    if (m) console.log(" hit", pat, m[0].slice(0, 160));
  }
}

peek("in-interim.html", ["Agricultural Promotion", "Sep 2", "__NEXT_DATA__", "application/json"]);
peek("ok-cal.html", ["api/", "graphql", "calendars", "No calendar"]);
peek("ok-notices.html", ["Agriculture", "Postsecondary", "Entire Month", "__VIEWSTATE"]);
peek("ar-month.html", ["Legislative Auditing", "tableRow", "meetingStartDate"]);
peek("nd-cal.html", ["events", "view-mode", "September"]);
peek("wy-cal.html", ["api/", "Meeting", "angular", "ng-"]);

try {
  const ks = JSON.parse(readFileSync("data/probe-ks-com.json", "utf8"));
  const rows = ks.results || [];
  console.log("\n======== ks committees", rows.length);
  const specials = rows.filter((c) => /special|post audit|interim|task force/i.test(`${c.committee_type} ${c.title} ${c.kpid}`));
  console.log("specials", specials.length);
  specials.slice(0, 20).forEach((c) => console.log(" ", c.kpid, c.committee_type, c.title, c.status));
} catch (err) {
  console.log("ks parse fail", err.message, readFileSync("data/probe-ks-com.json", "utf8").slice(0, 200));
}
