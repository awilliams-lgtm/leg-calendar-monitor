"use client";

import { useEffect, useState, type ReactNode } from "react";

type AdminState = {
  admin: boolean;
  setupRequired: boolean;
};

export function AdminGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AdminState | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    const res = await fetch("/api/admin/session", { credentials: "include" });
    const data = await res.json();
    setState({ admin: Boolean(data.admin), setupRequired: Boolean(data.setupRequired) });
    return data as AdminState;
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/session", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: state?.setupRequired ? "setup" : "login",
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not sign in.");
        return;
      }
      setPassword("");
      setState({ admin: true, setupRequired: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return <p className="text-sm text-muted">Checking admin access…</p>;
  }

  if (state.admin) return <>{children}</>;

  return (
    <section className="max-w-md space-y-4 rounded-2xl border border-border bg-panel p-5">
      <div>
        <h1 className="text-2xl">{state.setupRequired ? "Create admin password" : "Admin login"}</h1>
        <p className="mt-1 text-sm text-muted">
          {state.setupRequired
            ? "Set a password only you know. This locks Settings and the State Affairs connection so coworkers can view calendars but not change them."
            : "Settings and the shared State Affairs login are admin-only. Coworkers can still use the calendars without this password."}
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-3"
      >
        <input
          type="password"
          autoComplete={state.setupRequired ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={state.setupRequired ? "New password (8+ characters)" : "Admin password"}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || password.length < (state.setupRequired ? 8 : 1)}
          className="rounded-md bg-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? "Please wait…" : state.setupRequired ? "Save password" : "Log in"}
        </button>
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}
    </section>
  );
}

export function useAdmin() {
  const [admin, setAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    void fetch("/api/admin/session", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setAdmin(Boolean(data.admin)))
      .catch(() => setAdmin(false));
  }, []);

  return admin;
}
