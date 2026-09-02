"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GapTable } from "@/components/DashboardClient";
import { monthKey } from "@/lib/dates";
import { STATE_SOURCES } from "@/lib/states";
import type { GapRow } from "@/lib/types";

export default function GapsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading missing events…</p>}>
      <GapsClient />
    </Suspense>
  );
}

function GapsClient() {
  const params = useSearchParams();
  const initial = params.get("state") || "";
  const [state, setState] = useState(initial);
  const [month, setMonth] = useState(params.get("month") || monthKey());
  const [gaps, setGaps] = useState<GapRow[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ status: "open" });
    if (state) qs.set("state", state);
    if (month) qs.set("month", month);
    const res = await fetch(`/api/gaps?${qs}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to load missing events");
      return;
    }
    setGaps(data.gaps || []);
    setError("");
  }, [state, month]);

  useEffect(() => {
    void load();
  }, [load]);

  async function dismiss(id: number) {
    const row = gaps.find((g) => g.id === id);
    await fetch("/api/gaps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id,
        status: "dismissed",
        state: row?.state,
        officialSourceId: row?.officialSourceId,
      }),
    });
    await load();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl">Missing from State Affairs</h1>
        <p className="mt-1 text-sm text-muted">
          Official legislature meetings in the selected month that did not match a State Affairs
          meeting on the same day. After you add one on SA, mark it as on SA here — calendars and
          analytics will count it as already on SA.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="block max-w-xs text-sm">
          State
          <select
            className="mt-1 w-full rounded-md border border-border bg-panel px-3 py-2"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="">All states</option>
            {STATE_SOURCES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block max-w-xs text-sm">
          Month
          <input
            type="month"
            className="mt-1 w-full rounded-md border border-border bg-panel px-3 py-2"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {gaps.length === 0 && !error ? (
        <p className="rounded-xl border border-border bg-panel px-4 py-6 text-sm text-muted">
          No unmatched official meetings in this month. Flip the month, or open a state calendar to compare day by day.
        </p>
      ) : (
        <GapTable gaps={gaps} onDismiss={dismiss} />
      )}
    </div>
  );
}
