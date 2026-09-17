"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarLegend } from "@/components/SaBadge";
import { MonthGrid } from "@/components/MonthGrid";
import { monthKey, parseMonth, shiftMonth } from "@/lib/dates";
import type { StateMonthSummary } from "@/lib/types";

type Overview = {
  ok: boolean;
  demo?: boolean;
  scraping?: boolean;
  stale?: boolean;
  scraped?: number;
  scrapedCodes?: string[];
  saScraping?: boolean;
  saScraped?: number;
  saConnected?: boolean;
  saNeedsBrowserFetch?: boolean;
  saError?: string;
  total?: number;
  error?: string;
  month?: string;
  label?: string;
  states?: StateMonthSummary[];
  stats?: {
    openGaps: number;
    unread: number;
    officialEvents: number;
    saEvents: number;
    officialThisMonth?: number;
    saThisMonth?: number;
  };
};

export function CalendarsHome() {
  const [month, setMonth] = useState(monthKey());
  const [q, setQ] = useState("");
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    let stop = false;

    async function loadOverview() {
      const res = await fetch(`/api/calendar/overview?month=${month}`);
      const json = (await res.json()) as Overview;
      if (!stop) setData(json);
      return json;
    }

    async function run() {
      try {
        let first = await loadOverview();
        if (first.demo || first.scraping || first.saScraping) {
          const deadline = Date.now() + 12 * 60 * 1000;
          while (!stop && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 15000));
            first = await loadOverview();
            if (!first.demo && !first.scraping && !first.saScraping) break;
          }
        }
      } catch {
        if (!stop) setData({ ok: false, error: "Could not load calendars" });
      }
    }

    void run();
    return () => {
      stop = true;
    };
  }, [month]);

  const { year, month: monthNum } = parseMonth(month);
  const filtered = useMemo(() => {
    const rows = data?.states || [];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => r.code.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle));
  }, [data, q]);

  const totals = useMemo(() => {
    let onSa = 0;
    let missing = 0;
    let notRelevant = 0;
    for (const row of data?.states || []) {
      onSa += row.onSa;
      missing += row.missing;
      notRelevant += row.notRelevant || 0;
    }
    return { onSa, missing, notRelevant };
  }, [data]);

  const scrapedSet = useMemo(() => new Set(data?.scrapedCodes || []), [data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">Legislative calendars</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Each state card is one month of official House and Senate meetings. Teal means that
            official meeting is already on State Affairs. Amber means it is not. Change the month
            above the map to compare a different window — the counts follow that month, not all
            time.
          </p>
        </div>
        <CalendarLegend />
      </div>

      {data?.scraping ? (
        <p className="rounded-xl border border-border bg-panel px-4 py-3 text-sm">
          Pulling official calendars… {data.scraped || 0} / {data.total || 50} states
          {totals.missing + totals.onSa > 0 ? ` · ${totals.missing + totals.onSa} events so far` : ""}.
        </p>
      ) : data?.demo ? (
        <p className="rounded-xl border border-border bg-panel px-4 py-3 text-sm">
          Official calendars have not been stored yet. The server fills them every hour from 7am to
          5pm Eastern, and will catch up now if this is the first pull.
        </p>
      ) : null}
      {data?.saNeedsBrowserFetch ? (
        <p className="rounded-xl border border-border bg-panel px-4 py-3 text-sm">
          State Affairs blocked the meeting pull after {data.saScraped || 0} / {data.total || 50}{" "}
          states. Reconnect the shared SA login in Settings, then refresh this page.
          {data.saError ? ` (${data.saError})` : ""}
        </p>
      ) : data?.saScraping ? (
        <p className="rounded-xl border border-border bg-panel px-4 py-3 text-sm">
          Pulling State Affairs meetings… {data.saScraped || 0} / {data.total || 50} states
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-panel p-1">
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-sm hover:bg-teal-soft"
            onClick={() => setMonth(shiftMonth(month, -1))}
            aria-label="Previous month"
          >
            ←
          </button>
          <span className="min-w-[10rem] text-center text-sm font-medium">{data?.label || month}</span>
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-sm hover:bg-teal-soft"
            onClick={() => setMonth(shiftMonth(month, 1))}
            aria-label="Next month"
          >
            →
          </button>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a state"
          className="w-full max-w-xs rounded-md border border-border bg-panel px-3 py-2 text-sm"
        />
      </div>

      {data?.stats && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {data.label || month} — official vs State Affairs
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <Stat
              label="Official this month"
              value={data.stats.officialThisMonth ?? totals.onSa + totals.missing}
              hint="Meetings posted by legislatures in this month"
              href={`/analytics?month=${month}`}
            />
            <Stat
              label="Already on SA"
              value={totals.onSa}
              hint="Official meetings matched on SA, or marked as added"
              href={`/analytics?month=${month}`}
              tone="teal"
            />
            <Stat
              label="Missing from SA"
              value={totals.missing}
              hint="Official meetings this month still unmatched and not marked as added"
              href={`/gaps?month=${month}`}
              tone="accent"
            />
            <Stat
              label="Not relevant"
              value={totals.notRelevant}
              hint="Official meetings marked not relevant so they drop out of missing"
              href={`/gaps?month=${month}&status=irrelevant`}
            />
            <Stat
              label="SA listed this month"
              value={data.stats.saThisMonth ?? 0}
              hint="Meetings State Affairs itself has dated in this month"
              href={`/analytics?month=${month}`}
            />
          </div>
          <p className="text-xs text-muted">
            Cached overall (every date, not just this month): {data.stats.officialEvents.toLocaleString()}{" "}
            official · {data.stats.saEvents.toLocaleString()} State Affairs.
            SA live pull is this month forward and refreshes about every two hours when the
            session is connected.
            {data.saConnected === false ? " SA is not connected, so monthly SA counts stay at 0." : ""}
          </p>
        </div>
      )}

      {!data ? (
        <p className="text-sm text-muted">Loading calendars…</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {filtered.map((row) => (
            <Link
              key={row.code}
              href={`/states/${row.code}?month=${month}`}
              className="group rounded-xl border border-border bg-panel p-3 text-foreground no-underline transition-shadow hover:shadow-md"
            >
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <div>
                  <div className="font-[family-name:var(--font-display)] text-lg leading-tight">{row.name}</div>
                  <div className="text-[11px] uppercase tracking-wide text-muted">{row.code}</div>
                </div>
                <div className="text-right text-[11px] text-muted">
                  {row.onSa + row.missing > 0 ? (
                    <>
                      <div>{row.onSa + row.missing} official this month</div>
                      <div className="text-teal">{row.onSa} already on SA</div>
                      {row.missing > 0 && <div className="text-accent">{row.missing} missing from SA</div>}
                      {(row.notRelevant || 0) > 0 && <div>{row.notRelevant} not relevant</div>}
                      <div>{row.saMeetings || 0} on SA’s calendar</div>
                    </>
                  ) : scrapedSet.has(row.code) ? (
                    <>
                      <span>No official meetings this month</span>
                      {(row.saMeetings || 0) > 0 ? (
                        <div>{row.saMeetings} on SA’s calendar</div>
                      ) : (
                        <div>SA also has none this month</div>
                      )}
                    </>
                  ) : data.scraping ? (
                    <span>Loading…</span>
                  ) : (
                    <span>Open calendar</span>
                  )}
                </div>
              </div>
              <MonthGrid year={year} month={monthNum} days={row.days} compact />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  href?: string;
  tone?: "teal" | "accent";
}) {
  const inner = (
    <div className="rounded-xl border border-border bg-panel px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div
        className={`text-2xl font-semibold ${
          tone === "teal" ? "text-teal" : tone === "accent" ? "text-accent" : ""
        }`}
      >
        {value.toLocaleString()}
      </div>
      {hint ? <p className="mt-1 text-[11px] leading-snug text-muted">{hint}</p> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="text-foreground no-underline">
      {inner}
    </Link>
  ) : (
    inner
  );
}
