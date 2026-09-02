function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function truthyFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const t = value.trim().toLowerCase();
    return t === "true" || t === "1" || t === "yes" || t === "hidden";
  }
  return false;
}

function hiddenStatus(value: unknown): boolean {
  const t = String(value || "")
    .trim()
    .toLowerCase();
  return t === "hidden" || t === "unpublished" || t === "unlisted";
}

function hiddenInText(text: string): boolean {
  const t = String(text || "");
  if (!t) return false;
  return /[\[(]\s*hidden\s*[\])]/i.test(t) || /\bhidden\s*[-–—:]/i.test(t) || /[-–—:|]\s*hidden\b/i.test(t);
}

const HIDDEN_FLAGS = [
  "hidden",
  "is_hidden",
  "isHidden",
  "hide",
  "unpublished",
  "unlisted",
  "is_unlisted",
  "is_hidden_from_customer",
];
const STATUS_KEYS = ["status", "visibility", "visibility_status", "publication_status", "publish_status"];

/** Hidden meetings stay off SA comparison and are not treated as posted. */
export function isHiddenMeeting(input: {
  title?: string;
  description?: string;
  hidden?: unknown;
  raw?: unknown;
} | null | undefined): boolean {
  if (!input) return false;
  if (hiddenInText(`${input.title || ""} ${input.description || ""}`)) return true;

  const bags = [asRecord(input), asRecord(input.raw)].filter(Boolean) as Record<string, unknown>[];
  for (const bag of bags) {
    if (HIDDEN_FLAGS.some((key) => truthyFlag(bag[key]))) return true;
    if (STATUS_KEYS.some((key) => hiddenStatus(bag[key]))) return true;
    if (hiddenInText(`${bag.title || ""} ${bag.description || ""} ${bag.label || ""} ${bag.badge || ""}`)) return true;
  }
  return false;
}
