import assert from "node:assert/strict";
import test from "node:test";
import { bqDateTime, mapBqMeeting, stateCodeForId } from "../src/lib/sa-bigquery";

test("maps warehouse state_id onto LegCal state codes and drops extras", () => {
  assert.equal(stateCodeForId(17), "KY");
  assert.equal(stateCodeForId(22), "MI");
  assert.equal(stateCodeForId(46), "VA");
  assert.equal(stateCodeForId(52), "US");
  assert.equal(stateCodeForId(0), "");
  assert.equal(stateCodeForId(51), "");
});

test("keeps naive event datetimes from BigQuery", () => {
  assert.equal(bqDateTime("2026-11-05 14:00:00"), "2026-11-05T14:00:00");
  assert.equal(bqDateTime("2026-11-05T09:30:00.123"), "2026-11-05T09:30:00");
});

test("maps a warehouse meeting and skips cancelled rows", () => {
  const ev = mapBqMeeting({
    meeting_id: "286042",
    state_id: "22",
    event_title: "Senate Session",
    event_date: "2026-11-05 15:00:00",
    event_location: "Senate Chamber",
    event_description: "Agenda includes SB 12",
    sc_type: "LegislativeFloor",
    sc_document_url: "https://example.test/agenda.pdf",
    is_cancelled: "false",
  });
  assert.ok(ev);
  assert.equal(ev?.state, "MI");
  assert.equal(ev?.start, "2026-11-05T15:00:00");
  assert.equal(ev?.chamber, "senate");
  assert.equal(ev?.url, "https://example.test/agenda.pdf");
  assert.deepEqual(ev?.attachments, [{ label: "Document", url: "https://example.test/agenda.pdf" }]);
  assert.ok(ev?.bills.includes("SB 12"));

  assert.equal(
    mapBqMeeting({
      meeting_id: "1",
      state_id: "1",
      event_title: "Cancelled",
      event_date: "2026-11-05 10:00:00",
      is_cancelled: "true",
    }),
    null,
  );
});

test("decodes HTML in locations and ignores unknown jurisdictions", () => {
  const ev = mapBqMeeting({
    meeting_id: "288032",
    state_id: "35",
    event_title: "Ohio Chamber of Commerce",
    event_date: "2026-11-05 14:00:00",
    event_location: "COSI,&nbsp;333 W Broad Street,&nbsp;Columbus",
  });
  assert.equal(ev?.location, "COSI, 333 W Broad Street, Columbus");
  assert.equal(
    mapBqMeeting({
      meeting_id: "9",
      state_id: "0",
      event_title: "Enterprise",
      event_date: "2026-11-05 14:00:00",
    }),
    null,
  );
});
