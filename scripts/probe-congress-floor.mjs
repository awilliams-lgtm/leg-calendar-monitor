import { execFile } from "child_process";
import { promisify } from "util";
import { writeFileSync } from "fs";

const execFileAsync = promisify(execFile);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function curl(url) {
  const { stdout } = await execFileAsync(
    "curl.exe",
    ["-sL", "--compressed", "--max-time", "30", "-A", UA, "-w", "\n__STATUS__:%{http_code}", url],
    { maxBuffer: 20 * 1024 * 1024, windowsHide: true },
  );
  const marker = stdout.lastIndexOf("\n__STATUS__:");
  const body = marker >= 0 ? stdout.slice(0, marker) : stdout;
  const status = Number(marker >= 0 ? stdout.slice(marker + 12).trim() : 0);
  return { status, len: body.length, body };
}

const urls = [
  "https://docs.house.gov/floor/",
  "https://docs.house.gov/floor/Default.aspx",
  "https://docs.house.gov/floor/?week=20260901",
  "https://docs.house.gov/floor/Default.aspx?week=20260901",
  "https://docs.house.gov/floor/Download.aspx",
  "https://www.majorityleader.gov/",
  "https://www.majorityleader.gov/floor-schedule",
  "https://www.majorityleader.gov/news/floor-schedule",
  "https://clerk.house.gov/floorsummary",
  "https://clerk.house.gov/DaysInSession",
  "https://www.senate.gov/legislative/LIS/floor_schedule/week.htm",
  "https://www.senate.gov/legislative/LIS/floor_schedule/floor_schedule.htm",
  "https://www.senate.gov/legislative/2026_schedule.htm",
  "https://www.senate.gov/legislative/schedule.htm",
];

for (const url of urls) {
  try {
    const r = await curl(url);
    const text = r.body.replace(/\s+/g, " ");
    const hits = (text.match(/floor|convene|legislative day|session|September/gi) || []).length;
    console.log(JSON.stringify({ url, status: r.status, len: r.len, hits, sample: text.slice(0, 220) }));
    if (/docs.house.gov\/floor/.test(url) && r.status === 200) {
      writeFileSync("data/probe-house-floor2.html", r.body);
    }
    if (url.includes("2026_schedule") || url.includes("week.htm")) {
      writeFileSync(url.includes("2026") ? "data/probe-senate-year.html" : "data/probe-senate-week.html", r.body);
    }
  } catch (err) {
    console.log(JSON.stringify({ url, error: String(err).slice(0, 200) }));
  }
}
