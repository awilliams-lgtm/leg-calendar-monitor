export type MeetingAttachment = {
  label: string;
  url: string;
};

function decodeEntities(value: string): string {
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

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[^\S\n]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim(),
  );
}

function absUrl(base: string, href: string): string {
  try {
    return new URL(href, base || undefined).toString();
  } catch {
    return href;
  }
}

function cleanUrl(raw: string): string {
  return decodeEntities(raw)
    .trim()
    .replace(/[<>]/g, "")
    .replace(/[.,);]+$/g, "");
}

function looksHttp(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function normalizeLabel(label: string, url: string): string {
  const text = stripTags(label)
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text && !/^https?:\/\//i.test(text)) return text.slice(0, 80);
  if (/\.pdf($|\?)/i.test(url)) return "Agenda PDF";
  if (/material/i.test(url)) return "Meeting materials";
  return "Document";
}

function addAttachment(out: MeetingAttachment[], seen: Set<string>, label: string, href: string, baseUrl = "") {
  const url = cleanUrl(baseUrl ? absUrl(baseUrl, href) : href);
  if (!looksHttp(url) || /^(javascript|mailto):/i.test(url)) return;
  const key = url.split("#")[0].toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ label: normalizeLabel(label, url), url });
}

/** Pull agenda / materials / PDF links out of ICS HTML, Open States text, or stored notes. */
export function extractMeetingAttachments(text: string, baseUrl = ""): MeetingAttachment[] {
  const src = String(text || "");
  if (!src.trim()) return [];
  const found: MeetingAttachment[] = [];
  const seen = new Set<string>();

  for (const m of src.matchAll(/<a\b[^>]*href\s*=\s*['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a\s*>?/gi)) {
    addAttachment(found, seen, m[2], m[1], baseUrl);
  }
  for (const m of src.matchAll(/^ATTACH[^:]*:(.+)$/gim)) {
    addAttachment(found, seen, "", m[1], baseUrl);
  }
  for (const m of src.matchAll(/^([A-Za-z][A-Za-z0-9 /&._'-]{0,60}):\s*(https?:\/\/\S+)/gm)) {
    addAttachment(found, seen, m[1], m[2], baseUrl);
  }
  if (!found.length) {
    for (const m of src.matchAll(/https?:\/\/[^\s<>"'\\]+/g)) {
      addAttachment(found, seen, "", m[0], baseUrl);
    }
  }
  return found;
}

export function preferredMeetingUrl(attachments: MeetingAttachment[], fallback = ""): string {
  const ranked =
    attachments.find((a) => /agenda/i.test(a.label) && /\.pdf($|\?)/i.test(a.url)) ||
    attachments.find((a) => /agenda|material/i.test(a.label)) ||
    attachments.find((a) => /\.pdf($|\?)/i.test(a.url)) ||
    attachments[0];
  return ranked?.url || fallback;
}

export function withAttachmentLines(description: string, attachments: MeetingAttachment[]): string {
  const merged = extractMeetingAttachments(
    `${description}\n${attachments.map((a) => `${a.label}: ${a.url}`).join("\n")}`,
  );
  let body = stripTags(description);
  for (const a of merged) {
    body = body.replace(a.url, " ").replace(/\(\s*(Agenda|Meeting Materials|View Meeting|Committee Info|Registration)\s*\)/gi, " ");
  }
  body = body.replace(/[^\S\n]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  const lines = merged.map((a) => `${a.label}: ${a.url}`);
  return [body, ...lines].filter(Boolean).join("\n");
}

export function attachmentsFromEvent(url?: string, description?: string): MeetingAttachment[] {
  return extractMeetingAttachments([description || "", url || ""].filter(Boolean).join("\n"), url || "");
}

export function isPdfUrl(url?: string): boolean {
  return Boolean(url && /\.pdf($|\?)/i.test(url));
}

export function isDocumentLink(attachment: MeetingAttachment): boolean {
  return /agenda|material|packet|minutes|testimony|handout|notice|document|pdf|attachment/i.test(
    `${attachment.label} ${attachment.url}`,
  );
}
