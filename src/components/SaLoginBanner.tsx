"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAdmin } from "@/components/AdminGate";

type Status = {
  connected?: boolean;
  events?: number;
};

export function SaLoginBanner() {
  const admin = useAdmin();
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    void Promise.all([
      fetch("/api/sa/session").then((r) => r.json() as Promise<Status>),
      fetch("/api/sa/meetings").then((r) => r.json() as Promise<Status>),
    ])
      .then(([session, meetings]) => {
        setStatus({
          connected: Boolean(session.connected || meetings.connected),
          events: Number(meetings.events || 0),
        });
      })
      .catch(() => setStatus(null));
  }, []);

  if (!admin) return null;
  if (!status) return null;
  if (status.connected || (status.events || 0) > 0) return null;

  return (
    <div className="border-b border-border bg-teal-soft">
      <div className="mx-auto flex w-full max-w-[90rem] flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-6">
        <p>
          Connect the shared State Affairs work login so the team can compare official vs SA
          calendars.
        </p>
        <Link href="/settings#sa-login" className="rounded-md bg-teal px-3 py-1.5 text-xs font-medium text-white no-underline">
          Connect SA
        </Link>
      </div>
    </div>
  );
}
