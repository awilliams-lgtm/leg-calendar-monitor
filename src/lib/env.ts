/** Read at runtime. Avoid process.env.NAME so Next.js cannot inline secrets at build. */
export function envVar(name: string): string {
  return String(process.env[name] ?? "").trim();
}
