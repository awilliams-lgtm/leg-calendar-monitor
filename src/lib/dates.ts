export function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function parseMonth(value: string | null): { year: number; month: number; key: string } {
  const fallback = monthKey();
  const raw = value && /^\d{4}-\d{2}$/.test(value) ? value : fallback;
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(5, 7));
  return { year, month, key: raw };
}

export function shiftMonth(key: string, delta: number): string {
  const { year, month } = parseMonth(key);
  const d = new Date(year, month - 1 + delta, 1);
  return monthKey(d);
}

export function monthBounds(key: string): { start: string; end: string; label: string } {
  const { year, month } = parseMonth(key);
  const start = `${key}-01`;
  const endDate = new Date(year, month, 1);
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-01`;
  const label = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  return { start, end, label };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function monthDateKeys(month: string): string[] {
  const { year, month: m } = parseMonth(month);
  const n = daysInMonth(year, m);
  const out: string[] = [];
  for (let d = 1; d <= n; d++) {
    out.push(`${month}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

export function weekdayIndex(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getDay();
}

export function eventDay(start: string): string {
  return (start || "").slice(0, 10);
}

/** First of this month through the same window as SA admin (about four months out). */
export function upcomingWindow(now = new Date()): { from: string; to: string } {
  const from = `${monthKey(now)}-01`;
  const end = new Date(now.getFullYear(), now.getMonth() + 4, 2);
  const to = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  return { from, to };
}

export function daysInRange(from: string, to: string): string[] {
  const start = eventDay(from);
  const end = eventDay(to);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return [];
  const out: string[] = [];
  const [fy, fm, fd] = start.split("-").map(Number);
  const [ty, tm, td] = end.split("-").map(Number);
  const cur = new Date(fy, fm - 1, fd);
  const last = new Date(ty, tm - 1, td);
  while (cur.getTime() <= last.getTime()) {
    out.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`,
    );
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function formatTime(start: string): string {
  const t = start.slice(11, 16);
  if (!t || t === "00:00") return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const hr = ((h + 11) % 12) + 1;
  return `${hr}:${String(m).padStart(2, "0")} ${ap}`;
}
