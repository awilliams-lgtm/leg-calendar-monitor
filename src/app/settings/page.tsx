"use client";

import { useEffect, useState } from "react";
import { STATE_SOURCES } from "@/lib/states";
import { SaConnect } from "@/components/SaConnect";
import { AdminGate } from "@/components/AdminGate";

type Status = {
  openstates: boolean;
  stateAffairs: boolean;
  slack: boolean;
  email: boolean;
  cron: boolean;
  states: number;
};

function Flag({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-panel px-4 py-3">
      <span>{label}</span>
      <span className={ok ? "text-ok" : "text-danger"}>{ok ? "Ready" : "Missing"}</span>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <AdminGate>
      <SettingsInner />
    </AdminGate>
  );
}

function SettingsInner() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    void fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus);
  }, []);

  async function signOut() {
    await fetch("/api/admin/session", { method: "DELETE", credentials: "include" });
    window.location.href = "/";
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl">Settings</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Admin only. Coworkers can view calendars without access to this page or the shared State
            Affairs connection.
          </p>
        </div>
        <button type="button" onClick={() => void signOut()} className="rounded-md border border-border px-3 py-1.5 text-sm">
          Sign out of admin
        </button>
      </div>

      <div className="grid max-w-xl gap-2">
        {status ? (
          <>
            <Flag ok={status.openstates} label="Open States API (optional fallback)" />
            <Flag ok={status.stateAffairs} label="Shared State Affairs session" />
            <Flag ok={status.cron} label="Cron secret" />
            <Flag ok={status.slack} label="Slack alerts" />
            <Flag ok={status.email} label="Resend email alerts" />
          </>
        ) : (
          <p className="text-sm text-muted">Checking environment…</p>
        )}
      </div>

      <SaConnect />

      <section className="max-w-2xl space-y-2 text-sm">
        <h2 className="text-xl">Official calendars that block or use JavaScript</h2>
        <p className="text-muted">
          Open the legislature calendar in Chrome, wait until hearings are visible, then click{" "}
          <strong>Capture this official calendar</strong> in the connector popup. Use this for Hawaii,
          New York Senate, Arizona, New Jersey, and other pages that return 403 or a blank shell.
        </p>
        <h2 className="pt-4 text-xl">Unattended refresh</h2>
        <p className="text-muted">
          Production cron hits <code>/api/cron/tick</code> every hour from 7am to 5pm Eastern. That
          keeps official calendars current and reuses the shared State Affairs session, including any
          renewed cookies. On your work PC, <code>npm run sa:keep:install</code> adds a Windows task
          that can push a fresh browser login if Cloudflare Access expires. Manual: GET{" "}
          <code>/api/cron/tick?states=all</code> with <code>Authorization: Bearer $CRON_SECRET</code>.
        </p>
        <h2 className="pt-4 text-xl">Push SA hearings from the existing scraper</h2>
        <p className="text-muted">
          POST <code>/api/ingest/sa</code> with{" "}
          <code>{`{ "state": "MA", "hearings": [{ "entity_id", "title", "event_date", "event_time", "location", "sa_url", "chamber" }] }`}</code>
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl">Official calendars by chamber</h2>
        <p className="mb-2 text-sm text-muted">
          {STATE_SOURCES.length} jurisdictions (50 states plus U.S. Congress). Nebraska is unicameral.
          Every other state has separate House and Senate feeds (Assembly in CA, NY, NV, NJ).
        </p>
        <div className="overflow-auto rounded-xl border border-border bg-panel">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="bg-teal-soft/60 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">House / Assembly</th>
                <th className="px-3 py-2">Senate</th>
                <th className="px-3 py-2">Joint / other</th>
              </tr>
            </thead>
            <tbody>
              {STATE_SOURCES.map((s) => {
                const house = s.feeds.filter((f) => f.chamber === "house");
                const senate = s.feeds.filter((f) => f.chamber === "senate");
                const other = s.feeds.filter((f) => f.chamber === "joint" || f.chamber === "unicameral");
                const link = (url: string, label: string) => (
                  <a href={url} target="_blank" rel="noreferrer" className="block truncate" title={url}>
                    {label}
                  </a>
                );
                return (
                  <tr key={s.code} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">
                      {s.code} {s.name}
                    </td>
                    <td className="px-3 py-2">
                      {house.length ? house.map((f) => <div key={f.url}>{link(f.url, f.label)}</div>) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {senate.length ? senate.map((f) => <div key={f.url}>{link(f.url, f.label)}</div>) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {other.length ? other.map((f) => <div key={f.url}>{link(f.url, f.label)}</div>) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
