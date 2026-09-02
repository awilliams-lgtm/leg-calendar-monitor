"use client";

import { useEffect, useState } from "react";

const SA_MEETINGS = "https://admin.stateaffairs.com/meetings";
const SA_SITE = "https://www.stateaffairs.com";

type PlaywrightStatus = {
  running?: boolean;
  ok?: boolean;
  error?: string;
  queryCaptured?: boolean;
  meetings?: number;
  hiddenSkipped?: number;
};

type Session = {
  ok?: boolean;
  connected?: boolean;
  stale?: boolean;
  needsLogin?: boolean;
  email?: string;
  name?: string;
  source?: string;
  savedAt?: string;
  lastOkAt?: string;
  promptDaily?: boolean;
  playwrightFound?: boolean;
  fromEnv?: boolean;
  error?: string;
  profileError?: string;
  profile?: { email?: string; name?: string };
  playwright?: PlaywrightStatus;
};

export function SaConnect() {
  const [session, setSession] = useState<Session | null>(null);
  const [cookie, setCookie] = useState("");
  const [promptDaily, setPromptDaily] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  async function refresh(check = false) {
    const res = await fetch(`/api/sa/session${check ? "?check=1" : ""}`);
    const data = await res.json();
    setSession(data);
    if (typeof data.promptDaily === "boolean") setPromptDaily(data.promptDaily);
    return data as Session;
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!waiting) return;
    const poll = () => {
      void refresh(true).then((data) => {
        if (data.playwright?.running) return;
        if (data.playwright?.error && !data.playwright.running) {
          setWaiting(false);
          setMessage(data.playwright.error);
          return;
        }
        if (data.playwright?.ok && !data.playwright.running) {
          setWaiting(false);
          const who = data.profile?.name || data.profile?.email || data.name || data.email;
          const extra =
            typeof data.playwright.meetings === "number"
              ? ` Pulled ${data.playwright.meetings} visible meetings` +
                (data.playwright.hiddenSkipped ? `, skipped ${data.playwright.hiddenSkipped} hidden.` : ".")
              : "";
          setMessage(
            (who ? `Signed in as ${who}.` : "Playwright login saved.") + extra,
          );
        }
      });
    };
    const tick = window.setInterval(poll, 2500);
    const onFocus = () => poll();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [waiting]);

  async function post(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setMessage("");
    try {
      const res = await fetch("/api/sa/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setSession(data);
      if (!res.ok) setMessage(data.error || "Could not save the session.");
      else {
        setCookie("");
        const who = data.profile?.name || data.profile?.email || data.name || data.email;
        setMessage(
          who
            ? `Signed in as ${who}. Session saved for future runs.`
            : data.profileError || "Session saved.",
        );
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  async function signInWithPlaywright() {
    setBusy("playwright");
    setWaiting(true);
    setMessage(
      "A browser window should open. Finish JumpCloud / Cloudflare Access there. This page will pick up the session.",
    );
    try {
      const res = await fetch("/api/sa/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "playwright" }),
      });
      const data = await res.json();
      setSession(data);
      if (!res.ok) {
        setWaiting(false);
        setMessage(data.error || "Could not open the Playwright login window.");
      } else if (data.playwright?.error && !data.playwright.running) {
        setWaiting(false);
        setMessage(data.playwright.error);
      }
    } catch (err) {
      setWaiting(false);
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  async function signOut() {
    setBusy("out");
    setMessage("");
    setWaiting(false);
    try {
      const res = await fetch("/api/sa/session", { method: "DELETE" });
      const data = await res.json();
      setSession(data);
      setMessage("Saved session cleared. Env credentials are unchanged.");
    } finally {
      setBusy("");
    }
  }

  async function toggleDaily(next: boolean) {
    setPromptDaily(next);
    const res = await fetch("/api/sa/session", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ promptDaily: next }),
    });
    setSession(await res.json());
  }

  const connected = Boolean(session?.connected);
  const who = session?.name || session?.email;

  return (
    <section id="sa-login" className="max-w-2xl space-y-4 rounded-2xl border border-border bg-panel p-5">
      <div>
        <h2 className="text-xl">Shared State Affairs connection</h2>
        <p className="mt-1 text-sm text-muted">
          One work login powers the SA side of the calendars for everyone. Coworkers do not sign in
          here. Connect{" "}
          <a href={SA_SITE} target="_blank" rel="noreferrer">
            stateaffairs.com
          </a>{" "}
          or{" "}
          <a href={SA_MEETINGS} target="_blank" rel="noreferrer">
            admin.stateaffairs.com/meetings
          </a>
          , and this app caches those meetings for the whole team.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-background/70 px-4 py-3 text-sm">
        {session == null ? (
          "Checking session…"
        ) : connected ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-medium text-teal">
                Signed in{who ? ` as ${who}` : ""}
              </div>
              <div className="text-xs text-muted">
                {session.stale
                  ? "Daily check-in is due."
                  : session.fromEnv
                    ? "Using SA_COOKIE from the environment."
                    : session.source === "playwright"
                      ? "Using the saved Playwright login. Run it again when Cloudflare Access expires."
                    : session.source === "browser"
                      ? "Using the login from this browser."
                      : "Saved session will be reused until it expires."}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              disabled={Boolean(busy) || session.fromEnv}
              className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Sign out
            </button>
          </div>
        ) : waiting ? (
          <span className="text-teal">Waiting for your State Affairs login…</span>
        ) : (
          <span className="text-accent">
            SA is not connected yet. Official calendars still load; On SA / Not on SA will fill in
            after a work login is connected.
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void signInWithPlaywright()}
          disabled={Boolean(busy) || waiting}
          className="rounded-md bg-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy === "playwright" || waiting ? "Waiting for browser login…" : "Open Playwright login"}
        </button>
        {waiting && (
          <button
            type="button"
            onClick={() => {
              setWaiting(false);
              void refresh(true);
            }}
            className="rounded-md border border-border px-4 py-2 text-sm"
          >
            Cancel wait
          </button>
        )}
      </div>

      <div className="rounded-xl border border-border bg-teal-soft/40 px-4 py-3 text-sm">
        <p className="font-medium">Repeatable login</p>
        <p className="mt-2 text-muted">
          This opens an Edge or Chrome window on this computer, the same way the hearings scraper
          does. Sign in with JumpCloud once. The app saves that session under{" "}
          <code>data/sa-auth.json</code> and reuses it until Cloudflare Access expires. You can also
          run <code>npm run sa:login</code> from a terminal.
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={promptDaily}
          onChange={(e) => void toggleDaily(e.target.checked)}
        />
        <span>
          Prompt me about once a day if the shared session needs a refresh. Turn this off to keep
          using it until State Affairs signs it out.
        </span>
      </label>

      {session?.playwrightFound && (
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void post({ action: "import" }, "import")}
          className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-60"
        >
          {busy === "import" ? "Importing…" : "Use my saved hearings-tool login"}
        </button>
      )}

      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        className="text-sm text-muted"
      >
        {advanced ? "Hide paste-cookie fallback" : "Paste a session instead"}
      </button>

      {advanced && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Paste a session from the browser</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>
              Open{" "}
              <a href={SA_MEETINGS} target="_blank" rel="noreferrer">
                admin.stateaffairs.com/meetings
              </a>{" "}
              and finish Login with Code.
            </li>
            <li>
              DevTools → Network → pick a <code>graphql</code> request → copy the Cookie request header.
            </li>
            <li>Paste it here. It is saved locally, not in git.</li>
          </ol>
          <textarea
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            rows={4}
            placeholder="Cookie header, or a Playwright storage-state JSON file"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={Boolean(busy) || !cookie.trim()}
            onClick={() => void post({ cookie, promptDaily }, "save")}
            className="rounded-md bg-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy === "save" ? "Saving…" : "Save session"}
          </button>
        </div>
      )}

      {connected && (
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void post({ action: "snooze" }, "snooze")}
          className="text-sm"
        >
          {busy === "snooze" ? "Checking…" : "Use saved session today"}
        </button>
      )}

      {message && <p className="text-sm text-muted">{message}</p>}
      {session?.error && <p className="text-sm text-danger">{session.error}</p>}
      {session?.profileError && !session.error && (
        <p className="text-sm text-accent">{session.profileError}</p>
      )}
    </section>
  );
}
