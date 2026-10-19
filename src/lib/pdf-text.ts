import { execFile } from "child_process";
import { promisify } from "util";
import { inflateRawSync, inflateSync } from "zlib";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const EXTRACT = path.join(process.cwd(), "scripts", "extract-pdf.py");

/** Enough to read simple legislature PDFs on Vercel without Python. */
export function extractPdfVisibleText(buf: Buffer): string {
  const latin = buf.toString("latin1");
  const bits: string[] = [];
  const re = /FlateDecode[\s\S]{0,200}stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(latin))) {
    const data = Buffer.from(match[1], "latin1");
    for (const fn of [inflateSync, inflateRawSync]) {
      try {
        bits.push(fn(data).toString("utf8"));
        break;
      } catch {
        /* try the other inflater */
      }
    }
  }
  const inflated = bits.join("\n");
  return [...inflated.matchAll(/\((?:\\.|[^\\)])*\)/g)]
    .map((m) => m[0].slice(1, -1).replace(/\\n/g, "\n").replace(/\\(.)/g, "$1"))
    .join(" ");
}

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

function looksLikeScheduleText(text: string): boolean {
  const t = text.replace(/\0/g, " ");
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  if (letters < 40) return false;
  return (
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i.test(t) &&
    /\b(?:committee|hearing|session|agenda|room|am|pm|tbd)\b/i.test(t)
  );
}

async function extractWithUnpdf(buf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : String(text || "");
}

export async function fetchPdfText(url: string, timeoutMs = 25000): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "leg-pdf-"));
  const dest = path.join(dir, "doc.pdf");
  try {
    await downloadPdf(url, dest, timeoutMs);
    try {
      const py = await runPython(dest);
      if (py.trim()) return py;
    } catch {
      /* Vercel has no Python; fall through to JS extractors. */
    }
    const buf = await readFile(dest);
    try {
      const js = await extractWithUnpdf(buf);
      if (js.trim()) return js;
    } catch {
      /* keep going to the lightweight stream extractor */
    }
    const visible = extractPdfVisibleText(buf);
    if (looksLikeScheduleText(visible)) return visible;
    throw new Error(`PDF text extract failed for ${url}`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
