import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { databaseUrl } from "@/lib/db";

export const SA_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const META_KEY = "sa_session";

export type SaSession = {
  cookie: string;
  bearer: string;
  email: string;
  name: string;
  source: "env" | "paste" | "playwright" | "browser" | "none";
  savedAt: string;
  lastOkAt: string;
  promptDaily: boolean;
};

export type SaSessionPublic = {
  connected: boolean;
  stale: boolean;
  needsLogin: boolean;
  email: string;
  name: string;
  source: SaSession["source"];
  savedAt: string;
  lastOkAt: string;
  promptDaily: boolean;
  playwrightFound: boolean;
  fromEnv: boolean;
};

const empty = (): SaSession => ({
  cookie: "",
  bearer: "",
  email: "",
  name: "",
  source: "none",
  savedAt: "",
  lastOkAt: "",
  promptDaily: true,
});

let memory: SaSession | null = null;

export function sessionFilePath(): string {
  return path.join(process.cwd(), "data", "sa-session.json");
}

export function playwrightAuthPath(): string {
  return path.join(process.cwd(), "data", "sa-auth.json");
}

export function playwrightAuthPaths(): string[] {
  const root = path.join(process.cwd(), "..");
  return [
    playwrightAuthPath(),
    path.join(root, "hearings_needs_review", "stateaffairs_auth.json"),
    path.join(root, "stateaffairs_votes", "stateaffairs_auth.json"),
  ];
}

export async function playwrightAuthAvailable(): Promise<boolean> {
  for (const p of playwrightAuthPaths()) {
    try {
      await readFile(p);
      return true;
    } catch {
      /* missing */
    }
  }
  return false;
}

function isSaDomain(domain: string): boolean {
  const d = domain.replace(/^\./, "").toLowerCase();
  return (
    d === "stateaffairs.com" ||
    d.endsWith(".stateaffairs.com") ||
    d === "cloudflareaccess.com" ||
    d.endsWith(".cloudflareaccess.com")
  );
}

type CookieLike = { name?: string; value?: string; domain?: string };

function cookieDomainRank(domain: string): number {
  const d = domain.replace(/^\./, "").toLowerCase();
  if (d.startsWith("api.")) return 4;
  if (d.startsWith("admin.")) return 3;
  if (d.startsWith("pro.")) return 2;
  return 1;
}

export function cookiesToHeader(cookies: CookieLike[]): string {
  const ranked = cookies
    .filter((c) => c?.name && c?.value && isSaDomain(String(c.domain || "stateaffairs.com")))
    .sort((a, b) => cookieDomainRank(String(a.domain || "")) - cookieDomainRank(String(b.domain || "")));
  const byName = new Map<string, string>();
  for (const cookie of ranked) {
    byName.set(String(cookie.name), String(cookie.value));
  }
  return [...byName.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

export function parseSessionInput(raw: string): { cookie: string; bearer: string } {
  const text = raw.trim();
  if (!text) return { cookie: "", bearer: "" };
  if (text.startsWith("{")) {
    const json = JSON.parse(text) as { cookies?: CookieLike[]; cookie?: string; bearer?: string };
    if (Array.isArray(json.cookies)) return { cookie: cookiesToHeader(json.cookies), bearer: json.bearer || "" };
    return { cookie: String(json.cookie || ""), bearer: String(json.bearer || "") };
  }
  if (/^bearer\s+/i.test(text)) return { cookie: "", bearer: text.replace(/^bearer\s+/i, "").trim() };
  return { cookie: text.replace(/^cookie:\s*/i, "").trim(), bearer: "" };
}

function publicView(session: SaSession, extra: { playwrightFound: boolean; fromEnv: boolean }): SaSessionPublic {
  const now = Date.now();
  const last = Date.parse(session.lastOkAt || session.savedAt || "") || 0;
  const connected = Boolean(session.cookie || session.bearer);
  const stale = connected && session.promptDaily && last > 0 && now - last > SA_SESSION_TTL_MS;
  return {
    connected,
    stale,
    needsLogin: !connected || stale,
    email: session.email,
    name: session.name,
    source: session.source,
    savedAt: session.savedAt,
    lastOkAt: session.lastOkAt,
    promptDaily: session.promptDaily,
    playwrightFound: extra.playwrightFound,
    fromEnv: extra.fromEnv,
  };
}

async function readFileSession(): Promise<SaSession | null> {
  try {
    const raw = await readFile(sessionFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<SaSession>;
    return {
      ...empty(),
      ...parsed,
      cookie: parsed.cookie || "",
      bearer: parsed.bearer || "",
      promptDaily: parsed.promptDaily !== false,
    };
  } catch {
    return null;
  }
}

async function writeFileSession(session: SaSession) {
  const dir = path.dirname(sessionFilePath());
  await mkdir(dir, { recursive: true });
  await writeFile(sessionFilePath(), JSON.stringify(session, null, 2), "utf8");
}

async function readDbSession(): Promise<SaSession | null> {
  if (!databaseUrl()) return null;
  try {
    const { getMeta } = await import("@/lib/data");
    const raw = await getMeta(META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SaSession>;
    return {
      ...empty(),
      ...parsed,
      cookie: parsed.cookie || "",
      bearer: parsed.bearer || "",
      promptDaily: parsed.promptDaily !== false,
    };
  } catch {
    return null;
  }
}

async function writeDbSession(session: SaSession) {
  if (!databaseUrl()) return;
  const { setMeta } = await import("@/lib/data");
  await setMeta(META_KEY, JSON.stringify(session));
}

function envSession(): SaSession | null {
  const cookie = process.env.SA_COOKIE?.trim() || "";
  const bearer = process.env.SA_BEARER_TOKEN?.trim() || "";
  if (!cookie && !bearer) return null;
  return {
    ...empty(),
    cookie,
    bearer,
    source: "env",
    savedAt: new Date().toISOString(),
    lastOkAt: new Date().toISOString(),
    promptDaily: false,
  };
}

export async function loadSession(opts?: { reload?: boolean }): Promise<SaSession> {
  if (!opts?.reload && memory && (memory.cookie || memory.bearer)) return memory;
  const fromFile = await readFileSession();
  if (fromFile && (fromFile.cookie || fromFile.bearer)) {
    memory = fromFile;
    return fromFile;
  }
  const fromDb = await readDbSession();
  if (fromDb && (fromDb.cookie || fromDb.bearer)) {
    memory = fromDb;
    return fromDb;
  }
  const fromEnv = envSession();
  if (fromEnv) {
    memory = fromEnv;
    return fromEnv;
  }
  memory = empty();
  return memory;
}

export async function saveSession(next: SaSession) {
  memory = next;
  await writeFileSession(next).catch(() => undefined);
  await writeDbSession(next).catch(() => undefined);
}

export async function clearSession() {
  memory = empty();
  try {
    await unlink(sessionFilePath());
  } catch {
    /* missing */
  }
  if (databaseUrl()) {
    try {
      const { setMeta } = await import("@/lib/data");
      await setMeta(META_KEY, "");
    } catch {
      /* ignore */
    }
  }
}

export async function importPlaywrightSession(): Promise<SaSession> {
  for (const p of playwrightAuthPaths()) {
    try {
      const raw = await readFile(p, "utf8");
      const json = JSON.parse(raw) as { cookies?: CookieLike[] };
      const cookie = cookiesToHeader(json.cookies || []);
      if (!cookie) continue;
      const session: SaSession = {
        ...empty(),
        cookie,
        source: "playwright",
        savedAt: new Date().toISOString(),
        lastOkAt: "",
        promptDaily: true,
      };
      await saveSession(session);
      return session;
    } catch {
      /* try next */
    }
  }
  throw new Error("No saved State Affairs browser login found.");
}

export async function sessionStatus(opts?: { reload?: boolean }): Promise<SaSessionPublic> {
  const session = await loadSession(opts);
  const fromEnv = Boolean(process.env.SA_COOKIE?.trim() || process.env.SA_BEARER_TOKEN?.trim());
  return publicView(session, {
    playwrightFound: await playwrightAuthAvailable(),
    fromEnv,
  });
}

export async function markSessionOk(profile?: { email?: string; name?: string }) {
  const session = await loadSession();
  if (!session.cookie && !session.bearer) return session;
  session.lastOkAt = new Date().toISOString();
  if (profile?.email) session.email = profile.email;
  if (profile?.name) session.name = profile.name;
  await saveSession(session);
  return session;
}

export async function saConfigured(): Promise<boolean> {
  const session = await loadSession();
  return Boolean(session.cookie || session.bearer);
}
