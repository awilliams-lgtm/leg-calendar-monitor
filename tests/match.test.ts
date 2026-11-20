import assert from "node:assert/strict";
import test from "node:test";
import { toCalendarItems } from "../src/lib/calendar";
import { MATCH_THRESHOLD, scorePair } from "../src/lib/match";
import { foldOfficialIncoming } from "../src/lib/official-merge";
import type { CalendarEvent } from "../src/lib/types";

function ev(partial: Partial<CalendarEvent> & Pick<CalendarEvent, "sourceId" | "title" | "start">): CalendarEvent {
  return {
    state: "OH",
    bills: [],
    ...partial,
  };
}

test("does not match House and Senate committees that share a leftover word", () => {
  const score = scorePair(
    { title: "Senate Judiciary Committee Meeting", start: "2026-11-10T11:00:00", chamber: "house" },
    { title: "House Judiciary Hearing", start: "2026-11-10T16:00:00", chamber: "house" },
  );
  assert.ok(score < MATCH_THRESHOLD, `score ${score}`);
});

test("does not match Senate Education to the State Board of Education", () => {
  const score = scorePair(
    { title: "Senate Education Committee Meeting", start: "2026-11-17T15:00:00", chamber: "house" },
    { title: "State Board of Education", start: "2026-11-17T15:00:00" },
  );
  assert.ok(score < MATCH_THRESHOLD, `score ${score}`);
});

test("still matches the same committee with slightly different wording", () => {
  const score = scorePair(
    { title: "House Education Committee Meeting", start: "2026-11-09T14:45:00", chamber: "house" },
    { title: "House Education Committee", start: "2026-11-09T14:45:00", chamber: "house" },
  );
  assert.ok(score >= MATCH_THRESHOLD, `score ${score}`);
});

test("handled meetings do not keep a leftover unmatched SA title", () => {
  const items = toCalendarItems(
    [
      ev({
        sourceId: "va-1",
        state: "VA",
        title: "Chesapeake Bay Restoration Fund Advisory Committee",
        start: "2026-11-18T10:00:00",
      }),
    ],
    [{ title: "Autism Advisory Council", start: "2026-11-18T10:00:00" }],
    new Set(["VA|va-1"]),
  );
  assert.equal(items[0]?.onSa, true);
  assert.equal(items[0]?.handled, true);
  assert.equal(items[0]?.saMatchTitle, "");
});

test("same official source id keeps the incoming title instead of a swapped longer one", () => {
  const folded = foldOfficialIncoming(
    [
      ev({
        sourceId: "oh-cmte_h_judiciary_1",
        title: "Senate Judiciary Committee Meeting",
        start: "2026-11-10T11:00:00",
        chamber: "house",
      }),
    ],
    [
      ev({
        sourceId: "oh-cmte_h_judiciary_1",
        title: "House Judiciary Committee Meeting",
        start: "2026-11-10T11:00:00",
        chamber: "house",
      }),
    ],
  );
  assert.equal(folded[0]?.title, "House Judiciary Committee Meeting");
});

test("does not fold a House judiciary meeting into a Senate judiciary meeting", () => {
  const folded = foldOfficialIncoming(
    [
      ev({
        sourceId: "oh-cmte_s_judiciary_1",
        title: "Senate Judiciary Committee Meeting",
        start: "2026-11-10T09:45:00",
        chamber: "senate",
      }),
    ],
    [
      ev({
        sourceId: "os-house-judiciary",
        title: "House Judiciary Committee Meeting",
        start: "2026-11-10T11:00:00",
        chamber: "house",
      }),
    ],
  );
  assert.equal(folded.length, 2);
  assert.deepEqual(
    folded.map((row) => row.sourceId).sort(),
    ["oh-cmte_s_judiciary_1", "os-house-judiciary"],
  );
});
