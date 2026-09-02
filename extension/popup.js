const statusEl = document.getElementById("status");
const appUrlEl = document.getElementById("appUrl");

async function load() {
  const stored = await chrome.storage.local.get(["appUrl", "lastStatus", "lastSync"]);
  appUrlEl.value = stored.appUrl || "http://localhost:3000";
  const when = stored.lastSync ? new Date(stored.lastSync).toLocaleTimeString() : "";
  statusEl.textContent = stored.lastStatus
    ? `${stored.lastStatus}${when ? ` (${when})` : ""}`
    : "Not synced yet. Sign in on State Affairs, then click Sync.";
}

document.getElementById("login").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "open-login" });
});

document.getElementById("sync").addEventListener("click", async () => {
  statusEl.textContent = "Syncing…";
  await chrome.storage.local.set({ appUrl: appUrlEl.value.replace(/\/$/, "") });
  const data = await chrome.runtime.sendMessage({ type: "sync" });
  const who = data?.profile?.name || data?.profile?.email || data?.name || data?.email;
  statusEl.textContent = data?.ok
    ? who
      ? `Signed in as ${who}`
      : data.profileError || "Session sent to the calendar app."
    : data?.error || "Could not reach the calendar app.";
});

document.getElementById("capture").addEventListener("click", async () => {
  statusEl.textContent = "Capturing this page…";
  await chrome.storage.local.set({ appUrl: appUrlEl.value.replace(/\/$/, "") });
  const data = await chrome.runtime.sendMessage({ type: "capture-official" });
  statusEl.textContent = data?.ok
    ? `Saved ${data.state}: ${data.added || data.events || 0} official events.`
    : data?.error || "Could not capture this page.";
});

appUrlEl.addEventListener("change", () => {
  chrome.storage.local.set({ appUrl: appUrlEl.value.replace(/\/$/, "") });
});

load();
