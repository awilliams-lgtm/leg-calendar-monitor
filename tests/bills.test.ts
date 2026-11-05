import assert from "node:assert/strict";
import test from "node:test";
import { extractBills, sanitizeBills } from "../src/lib/match";

test("does not treat HTML headings as bills", () => {
  assert.deepEqual(extractBills("<h1>Committee meeting</h1><h2>Agenda</h2><h3>Notes</h3>"), []);
  assert.deepEqual(extractBills("H1 H2 H3 H4"), []);
  assert.deepEqual(sanitizeBills(["H 1", "H1", "H 2", "HR 1", "S 2"]), ["HR 1"]);
});

test("keeps real house and senate bill numbers", () => {
  assert.deepEqual(extractBills("Hearing on HB 441 and SB 12"), ["HB 441", "SB 12"]);
  assert.deepEqual(extractBills("H.B. 441 / S.B. 12"), ["HB 441", "SB 12"]);
  assert.deepEqual(extractBills("House Bill 90 and Senate Bill 7"), ["HB 90", "SB 7"]);
  assert.deepEqual(extractBills("H.R. 1 and HR 22"), ["HR 1", "HR 22"]);
});

test("keeps dotted single-chamber bills used by MA, NY, and SC", () => {
  assert.deepEqual(extractBills("H.5667 and S.3269"), ["H.5667", "S.3269"]);
  assert.deepEqual(extractBills("S. 2 comes up after S.400"), ["S.2", "S.400"]);
  assert.deepEqual(sanitizeBills(["H5667", "S 3280", "H 1"]), ["H.5667", "S.3280"]);
});

test("ignores room numbers and URLs", () => {
  assert.deepEqual(extractBills("Meet in Room H1. Agenda: https://example.gov/h1/packet.pdf"), []);
  assert.deepEqual(extractBills("Annex Room 154"), []);
});
