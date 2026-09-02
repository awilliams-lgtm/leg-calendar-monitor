const fs = require("fs");
const path = require("path");

function cookieHeaderFromPlaywright(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const cookies = raw.cookies || [];
  const byName = new Map();
  for (const c of cookies) {
    if (!c?.name || !c?.value) continue;
    const d = String(c.domain || "").replace(/^\./, "").toLowerCase();
    if (!(d === "stateaffairs.com" || d.endsWith(".stateaffairs.com") || d.includes("cloudflareaccess") || d.includes("jumpcloud"))) {
      continue;
    }
    byName.set(c.name, c.value);
  }
  return {
    header: [...byName.entries()].map(([n, v]) => `${n}=${v}`).join("; "),
    names: [...byName.keys()],
    hasCf: byName.has("CF_Authorization"),
    hasAdmin: byName.has("admin_token"),
    adminToken: byName.get("admin_token") || "",
  };
}

const votes = cookieHeaderFromPlaywright(
  path.join("..", "stateaffairs_votes", "stateaffairs_auth.json"),
);
const session = JSON.parse(fs.readFileSync(path.join("data", "sa-session.json"), "utf8"));

console.log(JSON.stringify({ votesNames: votes.names, hasCf: votes.hasCf, hasAdmin: votes.hasAdmin, sessionCookieLen: (session.cookie || "").length }));

async function fetchHtml(cookie, extra = {}) {
  const res = await fetch(
    "https://admin.stateaffairs.com/meetings?state=all&startDate=2026-09-01&endDate=2027-01-02&includeHidden=true",
    {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        cookie,
        ...extra,
      },
      redirect: "follow",
    },
  );
  const html = await res.text();
  const scripts = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]).filter((u) => /\.js/i.test(u));
  return {
    status: res.status,
    url: res.url,
    len: html.length,
    title: (html.match(/<title>([^<]+)/i) || [])[1] || "",
    scripts: scripts.slice(0, 30),
    hasMeetings: /getMeetingsList|includeHidden|MeetingsList/.test(html),
  };
}

(async () => {
  const a = await fetchHtml(votes.header);
  console.log("votesHtml", JSON.stringify({ status: a.status, url: a.url, title: a.title, len: a.len, scripts: a.scripts, hasMeetings: a.hasMeetings }));
  const b = await fetchHtml(session.cookie || "");
  console.log("sessionHtml", JSON.stringify({ status: b.status, url: b.url, title: b.title, len: b.len, scripts: b.scripts.slice(0, 8) }));

  const abs = a.scripts
    .map((u) => (u.startsWith("http") ? u : u.startsWith("/") ? `https://admin.stateaffairs.com${u}` : `https://admin.stateaffairs.com/${u}`))
    .slice(0, 15);
  for (const url of abs) {
    const res = await fetch(url, {
      headers: {
        cookie: votes.header,
        "user-agent": "Mozilla/5.0",
        referer: "https://admin.stateaffairs.com/meetings",
      },
    });
    const js = await res.text();
    const hits = [];
    for (const pat of ["getMeetingsList", "GetMeetingsList", "includeHidden", "startDate", "endDate", "getHearingsList", "itemsPerPage"]) {
      if (js.includes(pat)) hits.push(pat);
    }
    if (hits.length) {
      console.log(JSON.stringify({ js: url.split("/").pop(), status: res.status, len: js.length, hits }));
      const idx = js.indexOf("includeHidden");
      if (idx >= 0) console.log("ctx", js.slice(Math.max(0, idx - 200), idx + 400).replace(/\s+/g, " "));
      const idx2 = js.indexOf("getMeetingsList");
      if (idx2 >= 0) console.log("gql", js.slice(Math.max(0, idx2 - 300), idx2 + 500).replace(/\s+/g, " "));
    }
  }
})().catch((err) => {
  console.error("FAIL", err.message);
  process.exit(1);
});
