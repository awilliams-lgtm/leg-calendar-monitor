const MEETING_TYPE_SUFFIX =
  /(?:\s+-\s+(?:other|briefing|hearing|markup|work session|voting session|full committee))+$/i;

const INVERTED_COMMITTEE =
  /^(.+),\s+(task force to study|task force to|commission to advance|commission to study|work group on|house study group on)\s*$/i;

/** Strip Google Calendar type tags and un-invert "Deed Fraud, Task Force to Study". */
export function normalizeCommitteeTitle(title: string): string {
  let t = String(title || "")
    .replace(MEETING_TYPE_SUFFIX, "")
    .replace(/\s+/g, " ")
    .trim();
  const inv = t.match(INVERTED_COMMITTEE);
  if (inv) t = `${inv[2]} ${inv[1]}`.replace(/\s+/g, " ").trim();
  return t;
}
