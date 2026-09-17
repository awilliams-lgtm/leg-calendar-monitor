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
  const [view, setView] = useState<"open" | "irrelevant">(
    params.get("status") === "irrelevant" ? "irrelevant" : "open",
  );
  const [gaps, setGaps] = useState<GapRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ status: view });
    if (state) qs.set("state", state);
    if (month) qs.set("month", month);
    try {
      const res = await fetch(`/api/gaps?${qs}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load missing events");
        setGaps([]);
        return;
      }
      setGaps(data.gaps || []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load missing events");
      setGaps([]);
    } finally {
      setLoading(false);
    }
  }, [state, month, view]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateStatus(id: number, status: "open" | "dismissed" | "irrelevant") {
    const row = gaps.find((g) => g.id === id);
    await fetch("/api/gaps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id,
        status,
        state: row?.state,
        officialSourceId: row?.officialSourceId,
        title: row?.title,
        start: row?.start,
        chamber: row?.chamber,
      }),
    });
    await load();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl">
          {view === "irrelevant" ? "Not relevant" : "Missing from State Affairs"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {view === "irrelevant"
            ? "Official meetings marked as not relevant. They stay cached here so we can later turn repeated titles into code filters. Restore one if it should count as missing again."
            : "Official legislature meetings in the selected month that did not match a State Affairs meeting on the same day. Mark as on SA after you add it there — that human confirmation sticks across scrapes even if the official title or id changes. Not relevant hides junk we do not want on SA, without counting it as posted."}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex rounded-lg border border-border bg-panel p-1">
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-sm ${view === "open" ? "bg-teal-soft" : "hover:bg-teal-soft"}`}
            onClick={() => setView("open")}
          >
            Missing
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-sm ${view === "irrelevant" ? "bg-teal-soft" : "hover:bg-teal-soft"}`}
            onClick={() => setView("irrelevant")}
          >
            Not relevant
          </button>
        </div>
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
      {loading ? (
        <p className="text-sm text-muted">Loading missing events…</p>
      ) : gaps.length === 0 && !error ? (
        <p className="rounded-xl border border-border bg-panel px-4 py-6 text-sm text-muted">
          {view === "irrelevant"
            ? "Nothing marked not relevant in this month."
            : "No unmatched official meetings in this month. Flip the month, or open a state calendar to compare day by day."}
        </p>
      ) : (
        <GapTable
          gaps={gaps}
          onDismiss={view === "open" ? (id) => updateStatus(id, "dismissed") : undefined}
          onIrrelevant={view === "open" ? (id) => updateStatus(id, "irrelevant") : undefined}
          onRestore={view === "irrelevant" ? (id) => updateStatus(id, "open") : undefined}
        />
      )}
    </div>
  );
}
