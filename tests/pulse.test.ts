import assert from "node:assert/strict";
import test from "node:test";
import { postPulse, pulseEvent, syncOutcome } from "../src/lib/pulse";

test("syncOutcome maps a sync to supa-dupa's outcome vocabulary", () => {
  const base = { threw: false, keptLastGood: false, found: 0, failedNotes: 0 };
  assert.equal(syncOutcome({ ...base, found: 12 }), "succeeded");
  assert.equal(syncOutcome({ ...base, found: 12, failedNotes: 1 }), "succeeded");
  assert.equal(syncOutcome(base), "source_empty");
  assert.equal(syncOutcome({ ...base, failedNotes: 1 }), "failed");
  assert.equal(syncOutcome({ ...base, keptLastGood: true, failedNotes: 1 }), "failed");
  assert.equal(syncOutcome({ ...base, threw: true }), "failed");
});

test("pulseEvent names the state as source and partition, with a stable key", () => {
  const startedAt = new Date("2026-11-20T15:00:00.000Z");
  const finishedAt = new Date("2026-11-20T15:00:04.500Z");
  const ev = pulseEvent({ state: "oh", startedAt, finishedAt, outcome: "succeeded", found: 9, written: 9 });
  assert.equal(ev.source, "OH");
  assert.equal(ev.partition, "OH");
  assert.equal(ev.duration_ms, 4500);
  assert.equal(ev.event_key, "official:OH-2026-11-20T15:00:00.000Z");
  assert.equal(ev.occurred_at, "2026-11-20T15:00:04.500Z");
  assert.equal(ev.error, null);
});

test("postPulse sends nothing without a key, and never throws", async () => {
  const ev = pulseEvent({ state: "TX", startedAt: new Date(), finishedAt: new Date(), outcome: "failed", found: 0, written: 0, error: "boom" });
  let calls = 0;
  const fake = (async () => { calls += 1; return new Response("{}", { status: 200 }); }) as typeof fetch;

  delete process.env.SUPA_DUPA_COLLECTOR_KEY;
  assert.equal(await postPulse([ev], fake), false);
  assert.equal(calls, 0);

  process.env.SUPA_DUPA_COLLECTOR_KEY = "sdc_test";
  process.env.SUPA_DUPA_URL = "https://example.test/";
  let seen: { url: string; init?: RequestInit } | null = null;
  const capture = (async (url: string, init?: RequestInit) => { seen = { url, init }; return new Response("{}", { status: 200 }); }) as typeof fetch;
  assert.equal(await postPulse([ev], capture), true);
  assert.equal(seen!.url, "https://example.test/api/collector/events");
  assert.equal((seen!.init!.headers as Record<string, string>).authorization, "Bearer sdc_test");
  assert.deepEqual(JSON.parse(String(seen!.init!.body)).events[0].outcome, "failed");

  const broken = (async () => { throw new Error("network down"); }) as typeof fetch;
  assert.equal(await postPulse([ev], broken), false);
  delete process.env.SUPA_DUPA_COLLECTOR_KEY;
  delete process.env.SUPA_DUPA_URL;
});
