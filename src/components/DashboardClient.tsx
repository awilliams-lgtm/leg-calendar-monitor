"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MeetingExtras } from "@/components/MeetingExtras";
import type { GapRow, StateCoverage } from "@/lib/types";

type Overview = {
  ok: boolean;
  error?: string;
  demo?: boolean;
  stats?: { openGaps: number; unread: number; officialEvents: number; saEvents: number };
  coverage?: StateCoverage[];
  gaps?: GapRow[];
};

function tone(row: StateCoverage): string {
  if (row.lastError) return "border-danger/40 bg-danger/5";
  if (row.openGaps > 0) return "border-accent/40 bg-accent/5";
  if (row.officialCount > 0) return "border-ok/30 bg-ok/5";
  return "border-border bg-panel";
}

export function DashboardClient() {
  const [data, setData] = useState<Overview | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    void fetch("/api/overview")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ ok: false, error: "Could not load overview" }));
  }, []);

  const filtered = useMemo(() => {
    const rows = data?.coverage || [];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => r.code.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle));
  }, [data, q]);

  if (!data) return <p className="text-sm text-muted">Loading coverage…</p>;

  if (!data.ok) {
    return (
      <div className="rounded-xl border border-border bg-panel p-6">
        <h1 className="text-2xl">Connect a database to start syncing</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          This app is ready for Vercel. Add a Neon Postgres database, set <code>DATABASE_URL</code>,{" "}
          <code>OPENSTATES_API_KEY</code>, and a State Affairs cookie or bearer token, then let the
          15-minute cron walk all 50 states.
        </p>
        <p className="mt-3 text-sm">
          See <Link href="/settings">Settings</Link> for the env checklist.
        </p>
      </div>
    );
  }

  const stats = data.stats!;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">50-state calendar coverage</h1>
        <p className="mt-1 text-sm text-muted">
          Official legislative calendars compared to hearings already on State Affairs. Anything on
          the state calendar that SA does not have shows up as a gap.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Open gaps" value={stats.openGaps} href="/gaps" />
        <Stat label="Unread alerts" value={stats.unread} href="/alerts" />
        <Stat label="Official events" value={stats.officialEvents} />
        <Stat label="SA hearings" value={stats.saEvents} />
      </div>

      <div className="flex items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter states"
          className="w-full max-w-xs rounded-md border border-border bg-panel px-3 py-2 text-sm"
        />
        <span className="text-xs text-muted">{filtered.length} states</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-10">
        {filtered.map((row) => (
          <Link
            key={row.code}
            href={`/gaps?state=${row.code}`}
            className={`rounded-lg border p-2 no-underline ${tone(row)}`}
            title={row.lastError || row.name}
          >
            <div className="text-sm font-semibold text-foreground">{row.code}</div>
            <div className="truncate text-[11px] text-muted">{row.name}</div>
            <div className="mt-1 text-[11px] text-foreground">
              {row.openGaps} gap{row.openGaps === 1 ? "" : "s"}
            </div>
            <div className="text-[10px] text-muted">
              {row.officialCount} off · {row.saCount} sa
            </div>
          </Link>
        ))}
      </div>

      {data.gaps && data.gaps.length > 0 && (
        <section>
          <h2 className="mb-2 text-xl">Upcoming missing hearings</h2>
          <GapTable gaps={data.gaps.slice(0, 12)} />
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const inner = (
    <div className="rounded-xl border border-border bg-panel px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
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

export function GapTable({ gaps, onDismiss }: { gaps: GapRow[]; onDismiss?: (id: number) => void }) {
  return (
    <div className="overflow-auto rounded-xl border border-border bg-panel">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-teal-soft/60 text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-2">State</th>
            <th className="px-3 py-2">Chamber</th>
            <th className="px-3 py-2">When</th>
            <th className="px-3 py-2">Official event</th>
            <th className="px-3 py-2">Closest SA</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {gaps.map((g) => (
            <tr key={g.id} className="border-t border-border">
              <td className="px-3 py-2 font-medium">
                <Link href={`/states/${g.state}`} className="no-underline hover:underline">
                  {g.state}
                </Link>
              </td>
              <td className="px-3 py-2 text-xs text-muted">{g.chamber || "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-muted">{g.start.slice(0, 16).replace("T", " ")}</td>
              <td className="px-3 py-2">
                <div className="font-medium">{g.title}</div>
                {g.location ? <div className="text-xs text-muted">{g.location}</div> : null}
                <MeetingExtras url={g.url} bills={g.bills} description={g.description} />
              </td>
              <td className="px-3 py-2 text-xs text-muted">{g.saMatchTitle || "—"}</td>
              <td className="px-3 py-2">
                {onDismiss && g.status === "open" && (
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-xs"
                    onClick={() => onDismiss(g.id)}
                  >
                    Mark as on SA
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
