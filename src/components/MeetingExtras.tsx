"use client";

import { useEffect, useState } from "react";

type MeetingExtrasProps = {
  url?: string;
  bills?: string[];
  description?: string;
  defaultOpen?: boolean;
};

type Loaded = { bills: string[]; notes: string };

const cache = new Map<string, Loaded>();

function cleanNotes(value?: string): string {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function MeetingExtras({ url, bills, description, defaultOpen }: MeetingExtrasProps) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [loaded, setLoaded] = useState<Loaded | null>(() => (url && cache.get(url)) || null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !url || loaded || cache.has(url)) {
      if (url && cache.has(url) && !loaded) setLoaded(cache.get(url) || null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/official/agenda?url=${encodeURIComponent(url)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data?.ok) return;
        const next = {
          bills: Array.isArray(data.bills) ? data.bills : [],
          notes: String(data.notes || ""),
        };
        cache.set(url, next);
        setLoaded(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, url, loaded]);

  const listed = [...new Set([...(bills || []), ...(loaded?.bills || [])])];
  const notes = cleanNotes(loaded?.notes || description);

  return (
    <details
      className="mt-2 rounded-lg border border-border/70 bg-panel/80 px-3 py-2"
      open={defaultOpen}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer text-xs font-semibold text-teal">Agenda and bills</summary>
      <div className="mt-2 space-y-2 text-sm">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Agenda</div>
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="break-all">
              Open agenda / meeting details
            </a>
          ) : (
            <p className="text-muted">No agenda link on the official listing.</p>
          )}
        </div>
        {notes ? (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">On the agenda</div>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-muted">
              {notes.split("\n").filter(Boolean).slice(0, 16).map((line) => (
                <li key={line}>{line.slice(0, 240)}</li>
              ))}
            </ul>
          </div>
        ) : loading ? (
          <p className="text-xs text-muted">Looking up the official agenda…</p>
        ) : null}
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Bills</div>
          {listed.length ? (
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {listed.map((bill) => (
                <li key={bill} className="rounded-full bg-teal-soft px-2 py-0.5 text-xs font-medium text-teal">
                  {bill}
                </li>
              ))}
            </ul>
          ) : loading ? (
            <p className="text-muted">Checking the official page for bill numbers…</p>
          ) : (
            <p className="text-muted">No bill numbers listed for this meeting.</p>
          )}
        </div>
      </div>
    </details>
  );
}
