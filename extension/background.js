const DEFAULT_APP = "http://localhost:3000";
const SA_LOGIN = "https://admin.stateaffairs.com/meetings";

let syncTimer = null;
let pullingMeetings = false;

async function appUrl() {
  const stored = await chrome.storage.local.get(["appUrl"]);
  return String(stored.appUrl || DEFAULT_APP).replace(/\/$/, "");
}

function isSaCookie(cookie) {
  const domain = String(cookie.domain || "").replace(/^\./, "").toLowerCase();
  return domain === "stateaffairs.com" || domain.endsWith(".stateaffairs.com");
}

async function saCookies() {
  const all = await chrome.cookies.getAll({ domain: "stateaffairs.com" });
  return all.filter(isSaCookie).map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
  }));
}

function cookieHeader(cookies) {
  const byName = new Map();
  for (const cookie of cookies) byName.set(cookie.name, cookie.value);
  return [...byName.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function appFetch(path, options = {}) {
  const base = await appUrl();
  const res = await fetch(`${base}${path}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", "x-sa-connector": "1" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
}

function toEvent(row, state) {
  const id = String(row.entity_id || "").trim();
  const date = String(row.event_date || "").slice(0, 10);
  if (!id || !date) return null;
  const time = String(row.event_time || "").trim();
  const start = time && /^\d{1,2}:\d{2}/.test(time) ? `${date}T${time.length === 5 ? `${time}:00` : time}` : `${date}T00:00:00`;
  return {
    sourceId: id,
    state,
    title: row.title || "Untitled meeting",
    start,
    location: row.location || "",
    chamber: row.chamber || "",
    url: row.sa_url || "",
    bills: [],
  };
}

async function graphql(url, cookie, query, operationName, variables) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://admin.stateaffairs.com",
      referer: "https://admin.stateaffairs.com/meetings",
      cookie,
    },
    body: JSON.stringify({ operationName, query, variables }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`SA GraphQL HTTP ${res.status}`);
  if (payload.errors?.length) throw new Error(payload.errors.map((e) => e.message).filter(Boolean).join("; "));
  if (!payload.data) throw new Error("SA GraphQL returned no data");
  return payload.data;
}

async function paginate(url, cookie, query, operationName, listKey, state, stateId, extra = {}) {
  const events = [];
  let page = 1;
  const itemsPerPage = 50;
  while (page <= 20) {
    const data = await graphql(url, cookie, query, operationName, { stateId, page, itemsPerPage, ...extra });
    const rows = data[listKey]?.data || [];
    for (const row of rows) {
      const ev = toEvent(row, state);
      if (ev) events.push(ev);
    }
    const total = data[listKey]?.total_count || 0;
    if (page * itemsPerPage >= total || rows.length < itemsPerPage) break;
    page += 1;
  }
  return events;
}

async function pullMeetingsInBrowser() {
  if (pullingMeetings) return { ok: true, skipped: true };
  pullingMeetings = true;
  try {
    const cookies = await saCookies();
    if (!cookies.length) return { ok: false, error: "No State Affairs cookies yet." };
    const header = cookieHeader(cookies);
    const bootstrap = await appFetch("/api/sa/meetings");
    const gql = bootstrap.graphql;
    if (!gql?.url) return { ok: false, error: "Calendar app is not running." };

    const configs = await graphql(gql.url, header, gql.stateConfigs, "StateConfigs", {});
    const idByAbbr = new Map();
    for (const cfg of configs.stateConfigs || []) {
      const abbr = String(cfg.state_info?.state_abbr || "").trim().toUpperCase();
      if (abbr && typeof cfg.state_id === "number") idByAbbr.set(abbr, cfg.state_id);
    }

    const scraped = new Set(bootstrap.scrapedCodes || []);
    const remaining = (bootstrap.states || []).filter((code) => !scraped.has(code)).slice(0, 4);
    if (!remaining.length) {
      await chrome.storage.local.set({ lastStatus: `SA meetings up to date (${bootstrap.events || 0}).` });
      return { ok: true, events: bootstrap.events || 0 };
    }

    let meetingsQueryOk = true;
    for (const code of remaining) {
      const stateId = idByAbbr.get(code);
      let events = [];
      if (stateId != null) {
        try {
          if (meetingsQueryOk) {
            try {
              events = await paginate(gql.url, header, gql.meetings, "GetMeetingsList", "getMeetingsList", code, stateId);
              if (!events.length) meetingsQueryOk = false;
            } catch (err) {
              if (!/cannot query field|unknown field|getMeetingsList|HTTP 400|VALIDATION_ERROR/i.test(String(err.message || err))) throw err;
              meetingsQueryOk = false;
            }
          }
          if (!meetingsQueryOk) {
            events = await paginate(gql.url, header, gql.hearings, "GetHearingsList", "getHearingsList", code, stateId, {
              includeNeedsReviewBillHearings: false,
              onlyNeedsReviewBillHearings: false,
            });
          }
        } catch (err) {
          await chrome.storage.local.set({ lastStatus: `SA pull failed: ${err.message || err}` });
          return { ok: false, error: String(err.message || err) };
        }
      }
      await appFetch("/api/sa/meetings", {
        method: "POST",
        body: { action: "ingest", events, scrapedStates: [code] },
      });
    }

    const next = await appFetch("/api/sa/meetings");
    const lastStatus = `Synced ${next.events || 0} SA meetings (${next.scraped || 0}/${next.total || 50} states).`;
    await chrome.storage.local.set({ lastSync: Date.now(), lastStatus });
    return { ok: true, events: next.events || 0 };
  } finally {
    pullingMeetings = false;
  }
}

async function syncNow() {
  const cookies = await saCookies();
  if (!cookies.length) {
    await chrome.storage.local.set({ lastSync: Date.now(), lastStatus: "No State Affairs cookies yet." });
    return { ok: false, error: "No State Affairs cookies yet. Sign in on the admin or main site first." };
  }
  const data = await appFetch("/api/sa/session", {
    method: "POST",
    body: {
      action: "browser",
      source: "browser",
      cookies,
      promptDaily: false,
    },
  });
  const who = data.profile?.name || data.profile?.email || data.name || data.email;
  let lastStatus = data.ok
    ? who
      ? `Connected as ${who}`
      : data.profileError || "Session sent to the calendar app."
    : data.error || "Could not reach the calendar app. Is it running on localhost:3000?";

  const refresh = await appFetch("/api/sa/meetings", { method: "POST", body: { action: "refresh" } });
  if (refresh.needsBrowserFetch || !refresh.ok || refresh.skipped) {
    const pulled = await pullMeetingsInBrowser();
    if (pulled.ok) lastStatus = who ? `Connected as ${who}. SA meetings synced.` : "SA meetings synced.";
    else lastStatus = pulled.error || lastStatus;
  } else if (refresh.events) {
    lastStatus = who ? `Connected as ${who}. ${refresh.events} SA meetings.` : `${refresh.events} SA meetings cached.`;
  }

  await chrome.storage.local.set({ lastSync: Date.now(), lastStatus });
  return { ...data, meetings: refresh };
}

function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncNow().catch(() => undefined);
  }, 1500);
}

chrome.cookies.onChanged.addListener((change) => {
  if (!change.cookie || !isSaCookie(change.cookie)) return;
  scheduleSync();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("sa-sync", { periodInMinutes: 15 });
  syncNow().catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  syncNow().catch(() => undefined);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "sa-sync") syncNow().catch(() => undefined);
});

async function captureOfficialTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || tab.url.startsWith("chrome")) {
    return { ok: false, error: "Open an official legislature calendar in this tab first." };
  }
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      url: location.href,
      html: document.documentElement.outerHTML,
      title: document.title,
    }),
  });
  if (!result?.html) return { ok: false, error: "Could not read this page." };
  const data = await appFetch("/api/calendar/ingest", {
    method: "POST",
    body: { url: result.url, html: result.html },
  });
  const lastStatus = data.ok
    ? `Captured ${data.state}: ${data.added || data.events || 0} official events.`
    : data.error || "Capture failed.";
  await chrome.storage.local.set({ lastSync: Date.now(), lastStatus });
  return data;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "sync") {
    syncNow().then(sendResponse).catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message?.type === "capture-official") {
    captureOfficialTab().then(sendResponse).catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message?.type === "open-login") {
    chrome.tabs.create({ url: SA_LOGIN });
    sendResponse({ ok: true });
  }
});
