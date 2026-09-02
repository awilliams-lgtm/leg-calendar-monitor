import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const EXTRACT = path.join(process.cwd(), "scripts", "extract-pdf.py");

async function runPython(filePath: string): Promise<string> {
  const bins = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
  let last = "";
  for (const bin of bins) {
    try {
      const { stdout } = await execFileAsync(bin, [EXTRACT, filePath], {
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      });
      if (stdout.trim()) return stdout;
      last = `${bin} returned empty text`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`PDF text extract failed: ${last}`);
}

async function downloadPdf(url: string, dest: string, timeoutMs: number): Promise<void> {
  if (process.platform === "win32") {
    await execFileAsync(
      "curl.exe",
      ["-sL", "--compressed", "--max-time", String(Math.max(8, Math.ceil(timeoutMs / 1000))), "-A", UA, "-o", dest, url],
      { windowsHide: true, maxBuffer: 12 * 1024 * 1024 },
    );
    return;
  }
  const res = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": UA, Accept: "application/pdf,*/*" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

export async function fetchPdfText(url: string, timeoutMs = 25000): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "leg-pdf-"));
  const dest = path.join(dir, "doc.pdf");
  try {
    await downloadPdf(url, dest, timeoutMs);
    return await runPython(dest);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
