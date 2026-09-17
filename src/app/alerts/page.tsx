"use client";

import { useCallback, useEffect, useState } from "react";
import type { NotificationRow } from "@/lib/types";

export default function AlertsPage() {
  const [notes, setNotes] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/alerts", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to load alerts");
      return;
    }
    setNotes(data.notifications || []);
    setUnread(data.unread || 0);
    setError("");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead() {
    await fetch("/api/alerts", { method: "POST" });
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl">Alerts</h1>
          <p className="mt-1 text-sm text-muted">
            New official events, and official events that are not on State Affairs. Slack and email
            fire when these rows are first created.
          </p>
        </div>
        <button
          type="button"
          className="rounded-md bg-teal px-3 py-2 text-sm text-white"
          onClick={() => void markRead()}
        >
          Mark all read ({unread})
        </button>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-panel">
        {notes.length === 0 && <li className="px-4 py-6 text-sm text-muted">No alerts yet.</li>}
        {notes.map((n) => (
          <li key={n.id} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="rounded bg-teal-soft px-1.5 py-0.5 text-xs font-medium text-teal">
                {n.state}
              </span>
              <span className="text-xs uppercase tracking-wide text-muted">
                {n.kind === "missing_on_sa" ? "Missing on SA" : "New official"}
              </span>
              <span className="text-xs text-muted">{n.start.slice(0, 16).replace("T", " ")}</span>
              {!n.readAt && <span className="text-xs text-accent">unread</span>}
            </div>
            <div className="mt-1">
              {n.url ? (
                <a href={n.url} target="_blank" rel="noreferrer">
                  {n.title}
                </a>
              ) : (
                n.title
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
