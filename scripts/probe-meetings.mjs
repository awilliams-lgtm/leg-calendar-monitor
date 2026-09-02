const res = await fetch("https://admin.stateaffairs.com/meetings", {
  headers: { "User-Agent": "Mozilla/5.0" },
  redirect: "follow",
  signal: AbortSignal.timeout(20000),
});
const html = await res.text();
console.log("status", res.status, "url", res.url, "len", html.length);
const scripts = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
console.log("scripts", scripts.slice(0, 25));
const meetings = [...html.matchAll(/getMeetings\w*|GetMeetings\w*|meetingsList|getHearingsList/gi)].slice(0, 20);
console.log("hits", meetings.map((m) => m[0]));
console.log(html.slice(0, 500).replace(/\s+/g, " "));
