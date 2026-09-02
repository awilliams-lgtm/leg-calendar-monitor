import { extractBills } from "@/lib/match";
import { fetchText, stripTags } from "@/lib/html";
import { STATE_SOURCES } from "@/lib/states";

const ALLOWED_HOST = /^(docs\.house\.gov|clerk\.house\.gov|(www\.)?senate\.gov|[a-z0-9-]+\.senate\.gov|[a-z0-9-]+\.house\.gov)$/i;

const SOURCE_HOSTS = (() => {
  const hosts = new Set<string>();
  for (const src of STATE_SOURCES) {
    for (const raw of [src.officialUrl, src.icsUrl, ...src.feeds.map((f) => f.url)]) {
      try {
        if (raw) hosts.add(new URL(raw).hostname.toLowerCase());
      } catch {
        /* skip bad configured URLs */
      }
    }
  }
  return hosts;
})();

export type OfficialAgenda = {
  url: string;
  bills: string[];
  notes: string;
};

export function allowedOfficialAgendaUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const known = ALLOWED_HOST.test(host) || [...SOURCE_HOSTS].some((h) => host === h || host.endsWith(`.${h}`));
    return (u.protocol === "https:" || u.protocol === "http:") && known;
  } catch {
    return false;
  }
}

function sectionAfter(html: string, heading: RegExp): string {
  const hit = html.search(heading);
  if (hit < 0) return "";
  const rest = html.slice(hit);
  const close = rest.search(/<h[1-3]\b/i);
  const chunk = close > 0 ? rest.slice(0, close) : rest.slice(0, 4000);
  const next = chunk.search(/<h[1-3]\b/i);
  return next > 0 ? chunk.slice(0, next) : chunk;
}

export function parseOfficialAgendaPage(html: string, pageUrl: string): OfficialAgenda {
  const legislation = sectionAfter(html, />\s*Text of Legislation\s*</i);
  const items = [...legislation.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((m) => stripTags(m[1]).replace(/\s+/g, " ").trim())
    .filter((line) => line && !/^pdf$/i.test(line));
  const notes = items.slice(0, 20).join("\n");
  const bills = extractBills(`${notes}\n${stripTags(legislation || html).slice(0, 8000)}`);
  return { url: pageUrl, bills, notes };
}

export async function fetchOfficialAgenda(rawUrl: string): Promise<OfficialAgenda> {
  if (!allowedOfficialAgendaUrl(rawUrl)) {
    throw new Error("Agenda URL is not an allowed official host");
  }
  const html = await fetchText(rawUrl, 20000);
  return parseOfficialAgendaPage(html, rawUrl);
}
