import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const session = JSON.parse(readFileSync(path.join(root, "data", "sa-session.json"), "utf8"));
const captured = JSON.parse(readFileSync(path.join(root, "data", "sa-meetings-query.json"), "utf8"));

function upcomingWindow(now = new Date()) {
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const end = new Date(now.getFullYear(), now.getMonth() + 4, 2);
  const to = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  return { from, to };
}

function hidden(row) {
  return Boolean(row?.is_hidden_from_customer || row?.hidden || row?.is_hidden || row?.is_cancelled);
}

async function graphql(variables) {
  const res = await fetch("https://api.stateaffairs.com/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://admin.stateaffairs.com",
      referer: "https://admin.stateaffairs.com/meetings",
      "user-agent": "Mozilla/5.0",
      cookie: session.cookie || "",
    },
    body: JSON.stringify({
      operationName: "MeetingsSearchV2",
      query: captured.query,
      variables,
    }),
  });
  const json = await res.json();
  if (!res.ok || json.errors?.length) {
    throw new Error(json.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`);
  }
  return json.data?.meetingsSearchV2 || {};
}

async function pullRows({ from, to, stateId, label }) {
  const itemsPerPage = 100;
  const rows = [];
  let total = 0;
  let hiddenSkipped = 0;
  for (let page = 0; page < 250; page++) {
    const listed = await graphql({
      ...(captured.variables || {}),
      page,
      itemsPerPage,
      startDate: from,
      endDate: to,
      includeHidden: false,
      ...(typeof stateId === "number" ? { state: stateId } : {}),
    });
    const chunk = listed.data || [];
    total = listed.totalMeetingCount || total;
    for (const row of chunk) {
      if (hidden(row)) hiddenSkipped += 1;
      else rows.push(row);
    }
    console.log(
      `${label} page ${page + 1}: ${chunk.length} raw, kept ${rows.length}, hidden/cancelled ${hiddenSkipped}, reported ${total}`,
    );
    if (!chunk.length || chunk.length < itemsPerPage) break;
  }
  return { rows, hiddenSkipped, total };
}

function loadPrevRows() {
  try {
    const prev = JSON.parse(readFileSync(path.join(root, "data", "sa-meetings-captured.json"), "utf8"));
    return Array.isArray(prev.rows) ? prev.rows : [];
  } catch {
    return [];
  }
}

(async () => {
  const { from, to } = upcomingWindow();
  const wanted = process.argv.slice(2).map((s) => s.toUpperCase()).filter(Boolean);
  const prevRows = loadPrevRows();
  const extraIds = new Map();
  try {
    const cfgRes = await fetch("https://api.stateaffairs.com/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://admin.stateaffairs.com",
        referer: "https://admin.stateaffairs.com/meetings",
        cookie: session.cookie || "",
      },
      body: JSON.stringify({
        operationName: "StateConfigs",
        query: "query StateConfigs { stateConfigs { state_id state_info { state_abbr } } }",
        variables: {},
      }),
    });
    const cfgJson = await cfgRes.json();
    for (const row of cfgJson.data?.stateConfigs || []) {
      const abbr = String(row.state_info?.state_abbr || "").toUpperCase();
      if (abbr && typeof row.state_id === "number") extraIds.set(abbr, row.state_id);
    }
  } catch {
    /* fall back to ids already stored on captured rows */
  }
  for (const row of prevRows) {
    const abbr = String(row.state?.state_abbr || "").toUpperCase();
    if (abbr && typeof row.state_id === "number") extraIds.set(abbr, row.state_id);
  }

  const byId = new Map();
  let hiddenSkipped = 0;
  let total = 0;
  if (!wanted.length) {
    const all = await pullRows({ from, to, label: "all" });
    hiddenSkipped += all.hiddenSkipped;
    total = Math.max(total, all.total);
    for (const row of all.rows) {
      byId.set(String(row.meeting_id || row.id || ""), row);
      const abbr = String(row.state?.state_abbr || "").toUpperCase();
      if (abbr && typeof row.state_id === "number") extraIds.set(abbr, row.state_id);
    }
  } else {
    for (const row of prevRows) {
      byId.set(String(row.meeting_id || row.id || ""), row);
    }
  }

  const extraAbbr = [...new Set(wanted.length ? wanted : ["VA"])];
  for (const abbr of extraAbbr) {
    const stateId = extraIds.get(abbr);
    if (typeof stateId !== "number") {
      console.log(`No State Affairs id for ${abbr} in the all-states page; skipping extra pull.`);
      continue;
    }
    const extra = await pullRows({ from, to, stateId, label: abbr });
    hiddenSkipped += extra.hiddenSkipped;
    total = Math.max(total, extra.total);
    for (const row of extra.rows) {
      const id = String(row.meeting_id || row.id || "");
      if (id && !byId.has(id)) byId.set(id, row);
    }
  }

  const rows = [...byId.values()];
  writeFileSync(
    path.join(root, "data", "sa-meetings-captured.json"),
    JSON.stringify({ from, to, capturedAt: new Date().toISOString(), operationName: "MeetingsSearchV2", rows, hiddenSkipped }, null, 2),
  );
  const byState = {};
  for (const row of rows) {
    const code = (row.state?.state_abbr || "").toUpperCase() || "??";
    byState[code] = (byState[code] || 0) + 1;
  }
  const events = [];
  const scraped = new Set();
  for (const row of rows) {
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
    if (!state || !id || !date) continue;
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
  console.log(JSON.stringify({ from, to, visible: rows.length, cached: events.length, hiddenSkipped, total, states: scraped.size, byState }, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
