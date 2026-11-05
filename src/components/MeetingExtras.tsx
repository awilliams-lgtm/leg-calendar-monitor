"use client";

import { useEffect, useMemo, useState } from "react";
import { attachmentsFromEvent, isPdfUrl, type MeetingAttachment } from "@/lib/attachments";
import { sanitizeBills } from "@/lib/match";

type MeetingExtrasProps = {
  url?: string;
  bills?: string[];
  description?: string;
  attachments?: MeetingAttachment[];
  defaultOpen?: boolean;
};

type Loaded = { bills: string[]; notes: string; attachments: MeetingAttachment[] };

const cache = new Map<string, Loaded>();

function cleanNotes(value?: string): string {
  return String(value || "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^[A-Za-z][A-Za-z0-9 /&._'-]{0,60}:\s*$/gm, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function mergeAttachments(...groups: Array<MeetingAttachment[] | undefined>): MeetingAttachment[] {
  const seen = new Set<string>();
  const out: MeetingAttachment[] = [];
  for (const group of groups) {
    for (const item of group || []) {
      const key = item.url.split("#")[0].toLowerCase();
      if (!item.url || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export function MeetingExtras({ url, bills, description, attachments, defaultOpen }: MeetingExtrasProps) {
  const stored = useMemo(
    () => mergeAttachments(attachments, attachmentsFromEvent(url, description)),
    [attachments, url, description],
  );
  const [open, setOpen] = useState(Boolean(defaultOpen || stored.length));
  const [loaded, setLoaded] = useState<Loaded | null>(() => (url && cache.get(url)) || null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !url || loaded || cache.has(url) || isPdfUrl(url)) {
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
          attachments: Array.isArray(data.attachments) ? data.attachments : [],
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

  const listed = sanitizeBills([...(bills || []), ...(loaded?.bills || [])]);
  const notes = cleanNotes(loaded?.notes || description);
  const files = mergeAttachments(stored, loaded?.attachments);
  const hasAnything = Boolean(url || files.length || notes || listed.length);

  if (!hasAnything && !loading) return null;

  return (
    <details
      className="mt-2 rounded-lg border border-border/70 bg-panel/80 px-3 py-2"
      open={defaultOpen}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer text-xs font-semibold text-teal">Agenda and attachments</summary>
      <div className="mt-2 space-y-2 text-sm">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Attachments</div>
          {files.length ? (
            <ul className="mt-1 space-y-1">
              {files.map((file) => (
                <li key={file.url}>
                  <a href={file.url} target="_blank" rel="noreferrer" className="break-all">
                    {file.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : url ? (
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
