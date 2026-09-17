import { execFile } from "child_process";
import http from "http";
import https from "https";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function browserHeaders(url: string, accept: string): Record<string, string> {
  let origin = "";
  try {
    origin = new URL(url).origin;
  } catch {
    origin = "";
  }
  return {
    "User-Agent": UA,
    Accept: accept,
    "Accept-Language": "en-US,en;q=0.9",
    ...(origin ? { Referer: `${origin}/` } : {}),
  };
}

function looksBlocked(body: string): boolean {
  const head = body.slice(0, 800).toLowerCase();
  if (/request rejected|the requested url was rejected|access denied|just a moment|cf-browser-verification|attention required/.test(head)) {
    return true;
  }
  if (body.length < 600 && /<html/i.test(body) && !/<table|<article|schedule-event|committee/i.test(body)) {
    return true;
  }
  return false;
}

async function fetchViaCurl(
  url: string,
  timeoutMs: number,
  accept: string,
  extraHeaders?: Record<string, string>,
  postBody?: string,
): Promise<string> {
  const timeoutSec = String(Math.max(8, Math.ceil(timeoutMs / 1000)));
  const headerArgs = ["-H", `Accept: ${accept}`];
  for (const [k, v] of Object.entries(extraHeaders || {})) {
    headerArgs.push("-H", `${k}: ${v}`);
  }
  const postArgs = postBody ? ["-X", "POST", "--data", postBody] : [];
  const bins = process.platform === "win32" ? ["curl.exe", "curl"] : ["curl", "curl.exe"];
  let lastErr: unknown;
  for (const bin of bins) {
    try {
      const { stdout } = await execFileAsync(
        bin,
        ["-sL", "--compressed", "--max-time", timeoutSec, "-A", UA, ...headerArgs, ...postArgs, "-w", "\n__STATUS__:%{http_code}", url],
        { maxBuffer: 12 * 1024 * 1024, windowsHide: true },
      );
      const marker = stdout.lastIndexOf("\n__STATUS__:");
      const body = marker >= 0 ? stdout.slice(0, marker) : stdout;
      const status = Number(marker >= 0 ? stdout.slice(marker + 12).trim() : 0);
      if (status && status >= 400) throw new Error(`HTTP ${status} for ${url}`);
      return body;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`curl failed for ${url}`);
}

function fetchViaNodeHttp(
  url: string,
  timeoutMs: number,
  accept: string,
  extraHeaders?: Record<string, string>,
  postBody?: string,
  hops = 0,
): Promise<string> {
  if (hops > 5) return Promise.reject(new Error(`too many redirects for ${url}`));
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(err);
      return;
    }
    const lib = parsed.protocol === "http:" ? http : https;
    const headers: Record<string, string> = {
      ...browserHeaders(url, accept),
      ...extraHeaders,
      "Accept-Encoding": "identity",
      Connection: "close",
    };
    if (postBody) headers["Content-Length"] = String(Buffer.byteLength(postBody));
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: postBody ? "POST" : "GET",
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          resolve(fetchViaNodeHttp(new URL(location, url).toString(), timeoutMs, accept, extraHeaders, undefined, hops + 1));
          return;
        }
        if (status >= 400) {
          res.resume();
          reject(new Error(`HTTP ${status} for ${url}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`timeout for ${url}`));
    });
    if (postBody) req.write(postBody);
    req.end();
  });
}

async function fetchWithFallbacks(
  url: string,
  timeoutMs: number,
  accept: string,
  extraHeaders?: Record<string, string>,
  postBody?: string,
): Promise<string> {
  let lastErr: unknown;
  let blockedBody = "";
  try {
    const res = await fetch(url, {
      method: postBody ? "POST" : "GET",
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { ...browserHeaders(url, accept), ...extraHeaders },
      body: postBody,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const body = await res.text();
    if (!looksBlocked(body)) return body;
    blockedBody = body;
  } catch (err) {
    lastErr = err;
  }
  try {
    const viaHttp = await fetchViaNodeHttp(url, timeoutMs, accept, extraHeaders, postBody);
    if (!looksBlocked(viaHttp)) return viaHttp;
    if (viaHttp) blockedBody = viaHttp;
  } catch (err) {
    lastErr = err;
  }
  try {
    const viaCurl = await fetchViaCurl(url, timeoutMs, accept, extraHeaders, postBody);
    if (viaCurl && !looksBlocked(viaCurl)) return viaCurl;
    if (viaCurl) return viaCurl;
  } catch (err) {
    lastErr = err;
  }
  if (blockedBody) return blockedBody;
  throw lastErr instanceof Error ? lastErr : new Error(`fetch failed for ${url}`);
}

async function fetchBody(
  url: string,
  timeoutMs: number,
  accept: string,
  extraHeaders?: Record<string, string>,
): Promise<string> {
  return fetchWithFallbacks(url, timeoutMs, accept, extraHeaders);
}

export async function fetchText(
  url: string,
  timeoutMs = 18000,
  extraHeaders?: Record<string, string>,
): Promise<string> {
  return fetchBody(
    url,
    timeoutMs,
    "text/html,application/xhtml+xml,application/json,text/calendar,application/rss+xml;q=0.9,*/*;q=0.8",
    extraHeaders,
  );
}

export async function fetchTextPost(
  url: string,
  body: string,
  timeoutMs = 18000,
  extraHeaders?: Record<string, string>,
): Promise<string> {
  return fetchWithFallbacks(url, timeoutMs, "application/json, text/html, text/plain, */*", {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    ...extraHeaders,
  }, body);
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

export function absUrl(base: string, href: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

export function toIso(year: number, month: number, day: number, time?: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  let hh = 0;
  let mm = 0;
  if (time) {
    const m = time.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)?/i);
    if (m) {
      hh = Number(m[1]);
      mm = Number(m[2] || 0);
      const ap = (m[3] || "").toUpperCase();
      if (ap === "PM" && hh < 12) hh += 12;
      if (ap === "AM" && hh === 12) hh = 0;
    }
  }
  return `${year}-${pad(month)}-${pad(day)}T${pad(hh)}:${pad(mm)}:00`;
}

export const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

export function parseHumanDate(text: string, fallbackYear = new Date().getFullYear()): { y: number; m: number; d: number } | null {
  const iso = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
  const us = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) {
    let y = Number(us[3]);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    return { y, m: Number(us[1]), d: Number(us[2]) };
  }
  const named = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i,
  );
  if (named) {
    const m = MONTHS[named[1].toLowerCase()];
    if (m) return { y: named[3] ? Number(named[3]) : fallbackYear, m, d: Number(named[2]) };
  }
  const euro = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?,?\s+(\d{4})\b/i,
  );
  if (euro) {
    const m = MONTHS[euro[2].toLowerCase()];
    if (m) return { y: Number(euro[3]), m, d: Number(euro[1]) };
  }
  return null;
}

export async function fetchJson<T>(
  url: string,
  timeoutMs = 18000,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const body = await fetchBody(url, timeoutMs, "application/json, text/plain, */*", extraHeaders);
  return JSON.parse(body) as T;
}

export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}
