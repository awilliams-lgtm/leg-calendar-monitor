"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { useAdmin } from "@/components/AdminGate";

const ALL_LINKS = [
  { href: "/", label: "Calendars" },
  { href: "/analytics", label: "Analytics" },
  { href: "/gaps", label: "Missing on SA" },
  { href: "/alerts", label: "Alerts" },
  { href: "/settings", label: "Settings", admin: true },
];

export function SiteHeader() {
  const pathname = usePathname();
  const admin = useAdmin();
  const [sa, setSa] = useState<"unknown" | "on" | "off">("unknown");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/sa/meetings");
        const data = await res.json();
        if (cancelled) return;
        setSa(data?.events > 0 || data?.connected ? "on" : "off");
      } catch {
        if (!cancelled) setSa("off");
      }
    }
    void load();
    const tick = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, []);

  return (
    <header className="border-b border-border bg-panel/90 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-[90rem] flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex flex-col items-start gap-1 text-foreground no-underline">
          <img
            src="/state-affairs-logo.png"
            alt="State Affairs"
            className="h-8 w-auto sm:h-10"
          />
          <span className="text-xs font-normal text-muted">Legislative calendars</span>
        </Link>
        <nav className="flex flex-wrap items-center gap-1 text-sm font-medium">
          {ALL_LINKS.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/" || pathname.startsWith("/states/")
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={
                  active
                    ? "rounded-md bg-teal-soft px-3 py-2 text-teal no-underline"
                    : "rounded-md px-3 py-2 text-foreground no-underline hover:bg-teal-soft"
                }
              >
                {link.label}
              </Link>
            );
          })}
          {admin ? (
            <Link
              href="/settings#sa-login"
              className={
                sa === "on"
                  ? "rounded-full bg-teal-soft px-3 py-1.5 text-xs font-semibold text-teal no-underline"
                  : "rounded-full bg-[#f8eee6] px-3 py-1.5 text-xs font-semibold text-accent no-underline"
              }
            >
              {sa === "unknown" ? "…" : sa === "on" ? "SA connected" : "Connect SA"}
            </Link>
          ) : sa === "on" ? (
            <span className="rounded-full bg-teal-soft px-3 py-1.5 text-xs font-semibold text-teal">
              SA connected
            </span>
          ) : (
            <Link
              href="/settings"
              className="rounded-full bg-[#f8eee6] px-3 py-1.5 text-xs font-semibold text-accent no-underline"
            >
              Admin login
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
