"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarLegend, SaBadge } from "@/components/SaBadge";
import { MonthGrid } from "@/components/MonthGrid";
import { eventDay, formatTime, parseMonth, shiftMonth } from "@/lib/dates";
import { chamberLabel, stateByCode } from "@/lib/states";
import { MeetingExtras } from "@/components/MeetingExtras";
import type { CalendarItem, DayCounts } from "@/lib/types";

type Feed = { chamber: string; label: string; url: string };

type SaItem = {
  sourceId: string;
  title: string;
  start: string;
  location: string;
  chamber: string;
  url: string;
};

type Payload = {
  ok: boolean;
  live?: boolean;
  error?: string;
  month?: string;
  label?: string;
  saNote?: string;
  notes?: string[];
  items?: CalendarItem[];
  saItems?: SaItem[];
  days?: Record<string, DayCounts>;
  state?: { code: string; name: string; officialUrl: string; feeds: Feed[] };
};

export function StateCalendar({ code, initialMonth }: { code: string; initialMonth: string }) {
  const [month, setMonth] = useState(initialMonth);
  const [chamber, setChamber] = useState("all");
  const [coverage, setCoverage] = useState<"all" | "on" | "off">("all");
  const [selected, setSelected] = useState("");
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setData(null);
    setSelected("");
    void fetch(`/api/calendar?state=${code}&month=${month}`, { signal: ac.signal, cache: "no-store" })
      .then((r) => r.json())
      .then((json) => setData(json))
      .catch((err) => {
        if (err.name !== "AbortError") setData({ ok: false, error: "Could not load calendar" });
      });
    return () => ac.abort();
  }, [code, month]);

  const { year, month: monthNum } = parseMonth(month);

  const filtered = useMemo(() => {
    let items = (data?.items || []).filter((ev) => !ev.irrelevant);
    if (chamber !== "all") {
      items = items.filter((ev) => (ev.chamber || "").toLowerCase() === chamber);
    }
    if (coverage === "on") items = items.filter((ev) => ev.onSa);
    if (coverage === "off") items = items.filter((ev) => !ev.onSa);
    return items;
  }, [data, chamber, coverage]);

  const visibleDays = useMemo(() => {
    if (chamber === "all" && coverage === "all" && data?.days) return data.days;
    const days: Record<string, DayCounts> = {};
    for (const ev of filtered) {
      const d = eventDay(ev.start);
      if (!d) continue;
      if (!days[d]) days[d] = { onSa: 0, missing: 0, saMeetings: 0 };
      if (ev.onSa) days[d].onSa += 1;
      else days[d].missing += 1;
    }
    return days;
  }, [filtered, chamber, coverage, data]);

  const dayItems = useMemo(() => {
    if (!selected) return filtered;
    return filtered.filter((ev) => eventDay(ev.start) === selected);
  }, [filtered, selected]);

  const saDayItems = useMemo(() => {
    const items = data?.saItems || [];
    if (!selected) return items;
    return items.filter((ev) => eventDay(ev.start) === selected);
  }, [data, selected]);

  const chambers = data?.state?.feeds || [];
  const onSaCount = filtered.filter((ev) => ev.onSa).length;
  const missingCount = filtered.length - onSaCount;
  const saCount = data?.saItems?.length || 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-xs no-underline">
            ← All calendars
          </Link>
          <h1 className="mt-1 text-3xl">{data?.state?.name || code} Legislature</h1>
          <p className="mt-1 text-sm text-muted">
            Official meetings in this month, next to what State Affairs listed for the same month.
            Teal = that official meeting already has a same-day SA match. Amber = it does not.
          </p>
        </div>
        <CalendarLegend className="pt-6" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-panel p-1">
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-sm hover:bg-teal-soft"
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            ←
          </button>
          <span className="min-w-[10rem] text-center text-sm font-medium">{data?.label || month}</span>
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-sm hover:bg-teal-soft"
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            →
          </button>
        </div>

        <div className="flex flex-wrap gap-1">
          <FilterChip active={chamber === "all"} onClick={() => setChamber("all")}>
            All chambers
          </FilterChip>
          {chambers.map((f) => (
            <FilterChip key={f.chamber} active={chamber === f.chamber} onClick={() => setChamber(f.chamber)}>
              {f.label}
            </FilterChip>
          ))}
        </div>

        <div className="flex gap-1">
          <FilterChip active={coverage === "all"} onClick={() => setCoverage("all")}>
            All
          </FilterChip>
          <FilterChip active={coverage === "on"} onClick={() => setCoverage("on")}>
            On SA
          </FilterChip>
          <FilterChip active={coverage === "off"} onClick={() => setCoverage("off")}>
            Missing from SA
          </FilterChip>
        </div>
      </div>

      {data?.saNote && <p className="text-xs text-muted">{data.saNote}</p>}
      {data?.error && <p className="text-sm text-danger">{data.error}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <section className="rounded-2xl border border-border bg-panel p-4 sm:p-5">
          {!data ? (
            <p className="text-sm text-muted">Loading calendar…</p>
          ) : (
            <MonthGrid
              year={year}
              month={monthNum}
              days={visibleDays}
              selected={selected}
              onSelect={(iso) => setSelected((cur) => (cur === iso ? "" : iso))}
            />
          )}
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <span>
              <strong>{onSaCount + missingCount}</strong> official this month
            </span>
            <span>
              <strong className="text-teal">{onSaCount}</strong> already on SA
            </span>
            <span>
              <strong className="text-accent">{missingCount}</strong> missing from SA
            </span>
            <span>
              <strong>{saCount}</strong> meetings on SA’s calendar this month
            </span>
            {data?.state?.officialUrl && (
              <a href={data.state.officialUrl} target="_blank" rel="noreferrer">
                Official site
              </a>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-panel p-4 sm:p-5">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-xl">
              {selected
                ? new Date(`${selected}T12:00:00`).toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })
                : "Compare"}
            </h2>
            {selected && (
              <button type="button" className="text-xs text-muted" onClick={() => setSelected("")}>
                Show month
              </button>
            )}
          </div>
          {!data ? (
            <p className="text-sm text-muted">Loading events…</p>
          ) : (
            <div className="space-y-5">
              <AgendaList
                heading="Official legislature"
                empty={
                  filtered.length === 0
                    ? "No events found on this official calendar for this month."
                    : "No official events on this day."
                }
                items={dayItems}
                timeZone={stateByCode(code)?.tz}
              />
              <AgendaList
                heading="State Affairs meetings"
                empty={
                  saCount === 0
                    ? `State Affairs has no meetings dated in ${data?.label || "this month"}.`
                    : "No SA meetings on this day."
                }
                items={saDayItems}
                saSide
                timeZone={stateByCode(code)?.tz}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

type AgendaEvent = {
  sourceId: string;
  title: string;
  start: string;
  location?: string;
  chamber?: string;
  url?: string;
  bills?: string[];
  description?: string;
  onSa?: boolean;
  handled?: boolean;
  saMatchTitle?: string;
};

function AgendaList({
  heading,
  empty,
  items,
  saSide,
  timeZone,
}: {
  heading: string;
  empty: string;
  items: AgendaEvent[];
  saSide?: boolean;
  timeZone?: string;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{heading}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((ev) => (
            <li key={`${ev.sourceId}-${ev.start}`} className="rounded-xl border border-border/80 bg-background/60 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted">
                    {[formatTime(ev.start, timeZone) || "Time TBA", chamberLabel(ev.chamber || "")].filter(Boolean).join(" · ")}
                  </div>
                  {ev.url ? (
                    <a href={ev.url} target="_blank" rel="noreferrer" className="mt-0.5 block font-medium no-underline hover:underline">
                      {ev.title}
                    </a>
                  ) : (
                    <div className="mt-0.5 font-medium">{ev.title}</div>
                  )}
                </div>
                {!saSide && typeof ev.onSa === "boolean" && (
                  <SaBadge onSa={ev.onSa} handled={ev.handled && !ev.saMatchTitle} />
                )}
              </div>
              {ev.location && <div className="mt-1 text-xs text-muted">{ev.location}</div>}
              {ev.onSa && ev.saMatchTitle && ev.saMatchTitle !== ev.title && (
                <div className="mt-1 text-[11px] text-teal">Matched: {ev.saMatchTitle}</div>
              )}
              {!saSide && ev.onSa === false && (
                <MeetingExtras url={ev.url} bills={ev.bills} description={ev.description} />
              )}
              {saSide && ev.bills && ev.bills.length > 0 && (
                <div className="mt-1 text-xs text-muted">{ev.bills.join(", ")}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-teal px-3 py-1.5 text-xs font-medium text-white"
          : "rounded-full border border-border bg-panel px-3 py-1.5 text-xs font-medium hover:bg-teal-soft"
      }
    >
      {children}
    </button>
  );
}
