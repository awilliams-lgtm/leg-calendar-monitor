"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { monthKey, monthBounds, shiftMonth } from "@/lib/dates";
import type { AnalyticsChamber, AnalyticsPayload } from "@/lib/analytics";

const CHAMBERS: { id: AnalyticsChamber | ""; label: string }[] = [
  { id: "", label: "All chambers" },
  { id: "house", label: "House / Assembly" },
  { id: "senate", label: "Senate" },
  { id: "other", label: "Joint / other" },
];

function rate(onSa: number, official: number) {
  return official > 0 ? onSa / official : 0;
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function tone(n: number) {
  if (n >= 0.7) return "text-teal";
  if (n >= 0.4) return "text-warn";
  return "text-accent";
}

function barFill(n: number) {
  if (n >= 0.7) return "bg-teal";
  if (n >= 0.4) return "bg-warn";
  return "bg-accent";
}

export function AnalyticsClient() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const month = params.get("month") || monthKey();
  const state = (params.get("state") || "").toUpperCase();
  const chamber = (params.get("chamber") || "") as AnalyticsChamber | "";
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<"accuracy" | "activity" | "missing">("accuracy");

  function setQuery(next: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (!v) q.delete(k);
      else q.set(k, v);
    }
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  useEffect(() => {
    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), 25_000);
    setData(null);
    setError("");
    void fetch(`/api/analytics?month=${encodeURIComponent(month)}`, { signal: ac.signal, cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) setError(json.error || "Could not load analytics");
        else setData(json);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError("Could not load analytics");
        else setError("Analytics timed out. Try a single month instead of all dates.");
      });
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [month]);

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of data?.states || []) map.set(s.code, s.name);
    return map;
  }, [data]);

  const filteredOfficial = useMemo(() => {
    return (data?.official || []).filter((e) => {
      if (state && e.state !== state) return false;
      if (chamber && e.chamber !== chamber) return false;
      return true;
    });
  }, [data, state, chamber]);

  const filteredSa = useMemo(() => {
    return (data?.sa || []).filter((e) => {
      if (state && e.state !== state) return false;
      if (chamber && e.chamber !== chamber) return false;
      return true;
    });
  }, [data, state, chamber]);

  const totals = useMemo(() => {
    const official = filteredOfficial.length;
    const onSa = filteredOfficial.filter((e) => e.onSa).length;
    return {
      official,
      onSa,
      missing: official - onSa,
      saMeetings: filteredSa.length,
      rate: rate(onSa, official),
    };
  }, [filteredOfficial, filteredSa]);

  const chamberStats = useMemo(() => {
    const rows = CHAMBERS.filter((c) => c.id).map((c) => {
      const list = (data?.official || []).filter((e) => {
        if (state && e.state !== state) return false;
        return e.chamber === c.id;
      });
      const onSa = list.filter((e) => e.onSa).length;
      const saMeetings = (data?.sa || []).filter((e) => {
        if (state && e.state !== state) return false;
        return e.chamber === c.id;
      }).length;
      return {
        id: c.id as AnalyticsChamber,
        label: c.label,
        official: list.length,
        onSa,
        missing: list.length - onSa,
        saMeetings,
        rate: rate(onSa, list.length),
      };
    });
    return rows;
  }, [data, state]);

  const stateRows = useMemo(() => {
    const by = new Map<
      string,
      { official: number; onSa: number; house: number; senate: number; other: number; saMeetings: number }
    >();
    for (const s of data?.states || []) {
      by.set(s.code, { official: 0, onSa: 0, house: 0, senate: 0, other: 0, saMeetings: 0 });
    }
    for (const e of data?.official || []) {
      if (chamber && e.chamber !== chamber) continue;
      const row = by.get(e.state);
      if (!row) continue;
      row.official += 1;
      if (e.onSa) row.onSa += 1;
      row[e.chamber] += 1;
    }
    for (const e of data?.sa || []) {
      if (chamber && e.chamber !== chamber) continue;
      const row = by.get(e.state);
      if (row) row.saMeetings += 1;
    }
    const list = [...by.entries()].map(([code, row]) => ({
      code,
      name: names.get(code) || code,
      ...row,
      missing: row.official - row.onSa,
      rate: rate(row.onSa, row.official),
    }));
    list.sort((a, b) => {
      if (sort === "activity") return b.official - a.official || a.name.localeCompare(b.name);
      if (sort === "missing") return b.missing - a.missing || a.name.localeCompare(b.name);
      if (a.official && b.official) return a.rate - b.rate || b.official - a.official;
      return b.official - a.official;
    });
    return list;
  }, [data, chamber, names, sort]);

  const activeStates = stateRows.filter((s) => s.official > 0 || s.saMeetings > 0);
  const accuracyStates = stateRows.filter((s) => s.official > 0);
  const maxOfficial = Math.max(1, ...activeStates.map((s) => s.official));
  const maxSa = Math.max(1, ...chamberStats.map((c) => c.official), 1);

  const timeline = useMemo(() => {
    const keys =
      month === "all"
        ? [...new Set([...(data?.official || []), ...(data?.sa || [])].map((e) => e.day.slice(0, 7)))].sort()
        : [...new Set((data?.official || []).map((e) => e.day).concat((data?.sa || []).map((e) => e.day)))]
            .filter((d) => d.startsWith(month === "all" ? "" : month))
            .sort();
    return keys.map((key) => {
      const off = filteredOfficial.filter((e) => (month === "all" ? e.day.slice(0, 7) === key : e.day === key));
      const onSa = off.filter((e) => e.onSa).length;
      return {
        key,
        official: off.length,
        onSa,
        missing: off.length - onSa,
        saMeetings: filteredSa.filter((e) => (month === "all" ? e.day.slice(0, 7) === key : e.day === key)).length,
      };
    });
  }, [data, filteredOfficial, filteredSa, month]);

  const selectedName = state ? names.get(state) || state : "";
  const label = month === "all" ? "All cached dates" : data?.label || monthBounds(month).label;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">Analytics</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            How complete State Affairs is against official legislative calendars, then how busy each
            state and chamber is. Click a state or chamber to filter everything on this page.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-panel p-1">
            <button type="button" className="rounded-md px-3 py-1.5 text-sm hover:bg-teal-soft" onClick={() => setQuery({ month: shiftMonth(month === "all" ? monthKey() : month, -1) })}>
              ←
            </button>
            <span className="min-w-[10rem] text-center text-sm font-medium">{label}</span>
            <button type="button" className="rounded-md px-3 py-1.5 text-sm hover:bg-teal-soft" onClick={() => setQuery({ month: shiftMonth(month === "all" ? monthKey() : month, 1) })}>
              →
            </button>
          </div>
          <button
            type="button"
            onClick={() => setQuery({ month: month === "all" ? monthKey() : "all" })}
            className={month === "all" ? "rounded-full bg-teal px-3 py-1.5 text-xs font-medium text-white" : "rounded-full border border-border bg-panel px-3 py-1.5 text-xs font-medium"}
          >
            All dates
          </button>
        </div>
      </div>

      {(state || chamber) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Filtered to</span>
          {state && (
            <button type="button" onClick={() => setQuery({ state: null })} className="rounded-full bg-teal-soft px-3 py-1 text-xs font-semibold text-teal">
              {selectedName} ×
            </button>
          )}
          {chamber && (
            <button type="button" onClick={() => setQuery({ chamber: null })} className="rounded-full bg-teal-soft px-3 py-1 text-xs font-semibold text-teal">
              {CHAMBERS.find((c) => c.id === chamber)?.label} ×
            </button>
          )}
          <button type="button" onClick={() => setQuery({ state: null, chamber: null })} className="text-xs text-muted">
            Clear
          </button>
          {state && (
            <Link href={`/states/${state}?month=${month === "all" ? monthKey() : month}`} className="text-xs">
              Open {state} calendar
            </Link>
          )}
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
      {!data && !error && <p className="text-sm text-muted">Loading analytics…</p>}

      {data && (
        <>
          <section className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">SA calendar accuracy</p>
              <h2 className="text-2xl">Share of official events already on State Affairs</h2>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="rounded-2xl border border-border bg-panel p-5">
                <div className="flex flex-wrap items-center gap-6">
                  <AccuracyRing value={totals.official ? totals.rate : null} />
                  <div className="min-w-0 flex-1">
                    <div className={`font-[family-name:var(--font-display)] text-4xl ${tone(totals.rate)}`}>
                      {totals.official ? pct(totals.rate) : "—"}
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {totals.onSa} of {totals.official} official meetings
                      {selectedName ? ` in ${selectedName}` : " nationwide"}
                      {month === "all" ? " in the cache" : ` in ${label}`}
                      {chamber ? ` (${CHAMBERS.find((c) => c.id === chamber)?.label})` : ""}                       already
                      on State Affairs (matched or marked after you added them).
                    </p>
                    <div className="mt-4 h-3 overflow-hidden rounded-full bg-[#f8eee6]">
                      <div className={`h-full ${barFill(totals.rate)}`} style={{ width: `${totals.rate * 100}%` }} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 text-xs">
                      <span className="text-teal">{totals.onSa} already on SA</span>
                      <span className="text-accent">{totals.missing} missing from SA</span>
                      <span className="text-muted">{totals.saMeetings} on SA’s own calendar</span>
                    </div>
                    {!data.saConnected && (
                      <p className="mt-3 text-xs text-accent">SA meetings are not connected yet, so accuracy will read as 0%.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {chamberStats.map((c) => {
                  const active = chamber === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setQuery({ chamber: active ? null : c.id })}
                      className={`rounded-2xl border p-4 text-left transition-colors ${
                        active ? "border-teal bg-teal-soft" : "border-border bg-panel hover:border-teal/40"
                      }`}
                    >
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{c.label}</div>
                      <div className={`mt-1 font-[family-name:var(--font-display)] text-3xl ${tone(c.rate)}`}>
                        {c.official ? pct(c.rate) : "—"}
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {c.onSa}/{c.official} official · {c.saMeetings} on SA calendar
                      </p>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-teal-soft">
                        <div className={`h-full ${barFill(c.rate)}`} style={{ width: `${c.rate * 100}%` }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-panel p-5">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg">Accuracy by state</h3>
                <p className="text-xs text-muted">Lowest coverage first. Click a row to filter.</p>
              </div>
              <div className="space-y-1.5">
                {accuracyStates.length === 0 && <p className="text-sm text-muted">No official events in this range.</p>}
                {accuracyStates.map((s) => {
                  const active = state === s.code;
                  return (
                    <button
                      key={s.code}
                      type="button"
                      onClick={() => setQuery({ state: active ? null : s.code })}
                      className={`grid w-full grid-cols-[4.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm ${
                        active ? "bg-teal-soft" : "hover:bg-background/80"
                      }`}
                    >
                      <span className="font-medium">{s.code}</span>
                      <span className="relative h-2.5 overflow-hidden rounded-full bg-[#f8eee6]">
                        <span className={`absolute inset-y-0 left-0 ${barFill(s.rate)}`} style={{ width: `${s.rate * 100}%` }} />
                      </span>
                      <span className={`text-right text-xs font-semibold ${tone(s.rate)}`}>
                        {pct(s.rate)}
                        <span className="ml-1 font-normal text-muted">
                          {s.onSa}/{s.official}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Activity</p>
              <h2 className="text-2xl">How busy each chamber and state is</h2>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-border bg-panel p-5">
                <h3 className="text-lg">House vs Senate</h3>
                <p className="mb-4 text-xs text-muted">Official calendar events in this range. Click a chamber to filter accuracy too.</p>
                <div className="space-y-4">
                  {chamberStats
                    .filter((c) => c.id === "house" || c.id === "senate")
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setQuery({ chamber: chamber === c.id ? null : c.id })}
                        className="block w-full text-left"
                      >
                        <div className="mb-1 flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium">{c.label}</span>
                          <span className="text-sm">
                            <strong>{c.official}</strong>
                            <span className="text-muted"> official</span>
                          </span>
                        </div>
                        <div className="h-4 overflow-hidden rounded-full bg-teal-soft">
                          <div className={c.id === "senate" ? "h-full bg-teal" : "h-full bg-[#3d7a6a]"} style={{ width: `${(c.official / maxSa) * 100}%` }} />
                        </div>
                        <div className="mt-1 text-xs text-muted">
                          {c.saMeetings} SA meetings · {c.official ? pct(c.rate) : "—"} on SA
                        </div>
                      </button>
                    ))}
                </div>
                {chamberStats.find((c) => c.id === "other" && c.official > 0) && (
                  <p className="mt-4 text-xs text-muted">
                    Joint / unicameral / unlabeled: {chamberStats.find((c) => c.id === "other")?.official} official events.
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-border bg-panel p-5">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-lg">Busiest states</h3>
                  <div className="flex gap-1">
                    {(
                      [
                        ["accuracy", "Accuracy"],
                        ["activity", "Activity"],
                        ["missing", "Missing"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setSort(id)}
                        className={sort === id ? "rounded-full bg-teal px-2.5 py-1 text-[11px] font-medium text-white" : "rounded-full border border-border px-2.5 py-1 text-[11px]"}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  {activeStates.slice(0, 15).map((s) => {
                    const active = state === s.code;
                    return (
                      <button
                        key={s.code}
                        type="button"
                        onClick={() => setQuery({ state: active ? null : s.code })}
                        className={`grid w-full grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm ${
                          active ? "bg-teal-soft" : "hover:bg-background/80"
                        }`}
                      >
                        <span className="font-medium">{s.code}</span>
                        <span className="flex h-3 overflow-hidden rounded-full bg-background">
                          <span className="bg-[#3d7a6a]" style={{ width: `${(s.house / maxOfficial) * 100}%` }} title="House" />
                          <span className="bg-teal" style={{ width: `${(s.senate / maxOfficial) * 100}%` }} title="Senate" />
                          <span className="bg-border" style={{ width: `${(s.other / maxOfficial) * 100}%` }} title="Other" />
                        </span>
                        <span className="text-right text-xs text-muted">{s.official}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-[#3d7a6a]" /> House
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-teal" /> Senate
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-border" /> Joint / other
                  </span>
                </div>
              </div>
            </div>

            {timeline.length > 0 && (
              <div className="rounded-2xl border border-border bg-panel p-5">
                <h3 className="text-lg">{month === "all" ? "Official events by month" : "Official events by day"}</h3>
                <p className="mb-4 text-xs text-muted">Teal is already on SA. Amber is missing.</p>
                <div className="flex h-40 items-end gap-px">
                  {timeline.map((d) => {
                    const max = Math.max(1, ...timeline.map((x) => x.official));
                    const h = Math.max(d.official ? 8 : 2, Math.round((d.official / max) * 140));
                    const onH = d.official ? Math.round((d.onSa / d.official) * h) : 0;
                    return (
                      <div key={d.key} className="group relative flex min-w-0 flex-1 flex-col items-center justify-end" title={`${d.key}: ${d.onSa} on SA, ${d.missing} missing`}>
                        <div className="flex w-full max-w-4 flex-col justify-end overflow-hidden rounded-t-sm" style={{ height: h }}>
                          <div className="bg-accent" style={{ height: h - onH }} />
                          <div className="bg-teal" style={{ height: onH }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex justify-between text-[11px] text-muted">
                  <span>{timeline[0]?.key}</span>
                  <span>{timeline[timeline.length - 1]?.key}</span>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-panel">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h3 className="text-lg">All states</h3>
              <p className="text-xs text-muted">Click a state to filter. Open the calendar for the day-by-day view.</p>
            </div>
            <div className="overflow-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-teal-soft/60 text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2">State</th>
                    <th className="px-3 py-2">Accuracy</th>
                    <th className="px-3 py-2">Official</th>
                    <th className="px-3 py-2">On SA</th>
                    <th className="px-3 py-2">Missing</th>
                    <th className="px-3 py-2">House</th>
                    <th className="px-3 py-2">Senate</th>
                    <th className="px-3 py-2">SA meetings</th>
                  </tr>
                </thead>
                <tbody>
                  {stateRows.map((s) => (
                    <tr
                      key={s.code}
                      className={`cursor-pointer border-t border-border ${state === s.code ? "bg-teal-soft" : "hover:bg-background/70"}`}
                      onClick={() => setQuery({ state: state === s.code ? null : s.code })}
                    >
                      <td className="px-3 py-2 font-medium">
                        {s.code} <span className="font-normal text-muted">{s.name}</span>
                      </td>
                      <td className={`px-3 py-2 font-semibold ${s.official ? tone(s.rate) : "text-muted"}`}>
                        {s.official ? pct(s.rate) : "—"}
                      </td>
                      <td className="px-3 py-2">{s.official}</td>
                      <td className="px-3 py-2 text-teal">{s.onSa}</td>
                      <td className="px-3 py-2 text-accent">{s.missing}</td>
                      <td className="px-3 py-2">{s.house}</td>
                      <td className="px-3 py-2">{s.senate}</td>
                      <td className="px-3 py-2">{s.saMeetings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function AccuracyRing({ value }: { value: number | null }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const shown = value ?? 0;
  const dash = c * Math.min(1, Math.max(0, shown));
  return (
    <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0" aria-hidden>
      <circle cx="70" cy="70" r={r} fill="none" stroke="#e4efe9" strokeWidth="12" />
      <circle
        cx="70"
        cy="70"
        r={r}
        fill="none"
        stroke={shown >= 0.7 ? "#0f5c4c" : shown >= 0.4 ? "#9a6b12" : "#b85c2e"}
        strokeWidth="12"
        strokeDasharray={`${dash} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 70 70)"
      />
      <text x="70" y="76" textAnchor="middle" fill="#0f5c4c" fontSize="28" fontFamily="Georgia, serif">
        {value == null ? "—" : pct(shown)}
      </text>
    </svg>
  );
}
