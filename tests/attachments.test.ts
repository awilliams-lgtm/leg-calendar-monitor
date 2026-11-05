import assert from "node:assert/strict";
import test from "node:test";
import { parseIcsText } from "../src/lib/adapters/ics";
import {
  extractMeetingAttachments,
  preferredMeetingUrl,
  withAttachmentLines,
} from "../src/lib/attachments";
import { parseOfficialAgendaPage } from "../src/lib/official-agenda";

test("extracts labeled HTML agenda links from ICS descriptions", () => {
  const attachments = extractMeetingAttachments(
    `<a href='https://lis.blob.core.windows.net/files/1232112.PDF' target='_blank'>(Agenda)</a>
<a href="https://dls.virginia.gov/commissions/eur.htm?x=mtg">(Meeting Materials)</a>
<a href="https://apps.senate.virginia.gov/Senator/CommitteeMeetings.php">(View Meeting)</a>`,
  );
  assert.equal(attachments.length, 3);
  assert.equal(preferredMeetingUrl(attachments), "https://lis.blob.core.windows.net/files/1232112.PDF");
  assert.ok(attachments.some((a) => a.label === "Meeting Materials"));
});

test("keeps attachment URLs in stored description lines", () => {
  const text = withAttachmentLines("Senate Room A", [
    { label: "Agenda", url: "https://lis.blob.core.windows.net/files/123.PDF" },
  ]);
  assert.match(text, /Agenda: https:\/\/lis\.blob\.core\.windows\.net\/files\/123\.PDF/);
  assert.match(text, /Senate Room A/);
});

test("ICS parser stores agenda PDF instead of dropping HTML hrefs", () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
DESCRIPTION:<a href='https://lis.blob.core.windows.net/files/1232102.PDF'>(Agenda)</a>\\n<a href="https://house.vga.virginia.gov/now_playing">(View Meeting)</a>
DTSTART:20261104T140000
LOCATION:House Room B
SUMMARY:Manufacturing Development Commission
UID:va-test-uid
END:VEVENT
END:VCALENDAR`;
  const [ev] = parseIcsText(ics);
  assert.equal(ev.url, "https://lis.blob.core.windows.net/files/1232102.PDF");
  assert.match(String(ev.description), /lis\.blob\.core\.windows\.net\/files\/1232102\.PDF/);
  assert.match(String(ev.description), /house\.vga\.virginia\.gov\/now_playing/);
});

test("official agenda parser keeps PDF and materials links", () => {
  const parsed = parseOfficialAgendaPage(
    `<h2>Text of Legislation</h2><ul><li>HB 1 Example</li></ul>
     <a href="/files/packet.pdf">Meeting Materials</a>`,
    "https://lis.virginia.gov/Meeting/Calendar",
  );
  assert.ok(parsed.bills.includes("HB 1"));
  assert.ok(parsed.attachments.some((a) => /packet\.pdf/i.test(a.url)));
});
