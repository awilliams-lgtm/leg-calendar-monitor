import { execFile } from "child_process";
import { promisify } from "util";
import { writeFileSync } from "fs";

const execFileAsync = promisify(execFile);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function curl(url) {
  const { stdout } = await execFileAsync(
    "curl.exe",
    ["-sL", "--compressed", "--max-time", "25", "-A", UA, "-w", "\n__STATUS__:%{http_code}", url],
    { maxBuffer: 15 * 1024 * 1024, windowsHide: true },
  );
  const marker = stdout.lastIndexOf("\n__STATUS__:");
  const body = marker >= 0 ? stdout.slice(0, marker) : stdout;
  const status = Number(marker >= 0 ? stdout.slice(marker + 12).trim() : 0);
  return { status, len: body.length, body };
}

const urls = [
  "https://www.senate.gov/legislative/2026_schedule.xml",
  "https://www.senate.gov/legislative/2025_schedule.xml",
  "https://www.senate.gov/legislative/LIS/floor_activity/",
  "https://www.senate.gov/legislative/LIS/floor_activity/floor_activity.xml",
  "https://clerk.house.gov/floorsummary/floor-download.aspx",
  "https://clerk.house.gov/floorsummary/floor.aspx?day=20260901",
  "https://clerk.house.gov/floorsummary/floor.aspx?day=20260902",
  "https://docs.house.gov/floor/Download.aspx?file=20260901.xml",
  "https://docs.house.gov/floor/Download.aspx?week=20260901",
];

for (const url of urls) {
  try {
    const r = await curl(url);
    console.log(JSON.stringify({ url, status: r.status, len: r.len, sample: r.body.replace(/\s+/g, " ").slice(0, 280) }));
    if (url.includes("2026_schedule.xml")) writeFileSync("data/probe-senate-schedule.xml", r.body);
    if (url.includes("day=20260901")) writeFileSync("data/probe-house-clerk-day.xml", r.body);
  } catch (err) {
    console.log(JSON.stringify({ url, error: String(err).slice(0, 180) }));
  }
}
