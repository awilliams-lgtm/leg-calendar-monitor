import { spawn } from "child_process";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

const LOCK = path.join(process.cwd(), "data", "sa-playwright.lock");
const STATUS = path.join(process.cwd(), "data", "sa-playwright-status.json");
const SCRIPT = path.join(process.cwd(), "scripts", "sa-login.mjs");

export type PlaywrightStatus = {
  running: boolean;
  pid?: number;
  ok?: boolean;
  at?: string;
  error?: string;
  queryCaptured?: boolean;
  meetings?: number;
  hiddenSkipped?: number;
};

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function playwrightStatus(): Promise<PlaywrightStatus> {
  let lock: { pid?: number } = {};
  try {
    lock = JSON.parse(await readFile(LOCK, "utf8")) as { pid?: number };
  } catch {
    /* none */
  }
  const running = typeof lock.pid === "number" && alive(lock.pid);
  let saved: Partial<PlaywrightStatus> = {};
  try {
    saved = JSON.parse(await readFile(STATUS, "utf8")) as PlaywrightStatus;
  } catch {
    /* none */
  }
  return {
    running,
    pid: running ? lock.pid : undefined,
    ok: saved.ok,
    at: saved.at,
    error: running ? undefined : saved.error,
    queryCaptured: saved.queryCaptured,
    meetings: saved.meetings,
    hiddenSkipped: saved.hiddenSkipped,
  };
}

export async function startPlaywrightLogin(): Promise<PlaywrightStatus> {
  const current = await playwrightStatus();
  if (current.running) return current;

  await mkdir(path.dirname(LOCK), { recursive: true });
  const child = spawn(process.execPath, [SCRIPT], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    env: { ...process.env },
  });
  if (!child.pid) throw new Error("Could not start the Playwright login window.");
  await writeFile(LOCK, JSON.stringify({ pid: child.pid, at: new Date().toISOString() }), "utf8");
  await writeFile(
    STATUS,
    JSON.stringify({ running: true, at: new Date().toISOString() } satisfies PlaywrightStatus, null, 2),
    "utf8",
  );
  child.unref();
  return { running: true, pid: child.pid };
}

export async function clearPlaywrightLock() {
  try {
    await unlink(LOCK);
  } catch {
    /* missing */
  }
}
