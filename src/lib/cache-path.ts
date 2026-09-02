import path from "path";

/** Local data/ folder, or /tmp on Vercel where the deploy filesystem is read-only. */
export function cacheDir(): string {
  if (process.env.VERCEL) return path.join("/tmp", "leg-calendar-monitor");
  return path.join(process.cwd(), "data");
}

export function cacheFile(name: string): string {
  return path.join(cacheDir(), name);
}
