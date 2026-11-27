import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, win32 } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { PresentationContent } from "@deckai/contracts";
import { renderPresentationDocument, type RenderAssets } from "@deckai/renderer";

const runBrowser = promisify(execFile);
export const maxPdfBytes = 10 * 1024 * 1024;

export function findPdfBrowser(platform: NodeJS.Platform = process.platform): string | undefined {
  if (process.env.PDF_BROWSER_PATH) return process.env.PDF_BROWSER_PATH;
  const candidates = platform === "win32"
    ? [process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", process.env.ProgramFiles ?? "C:/Program Files"].flatMap(root => {
      const core = win32.join(root, "Microsoft", "EdgeCore");
      let versions: string[] = [];
      try { versions = readdirSync(core).filter(version => /^\d+\.\d+\.\d+\.\d+$/.test(version)).sort((a, b) => b.localeCompare(a, "en", { numeric: true })); } catch { /* EdgeCore is optional. */ }
      return [win32.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
        ...versions.map(version => win32.join(core, version, "msedge.exe")),
        win32.join(root, "Google", "Chrome", "Application", "chrome.exe")];
    })
    : ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"];
  return candidates.find(candidate => existsSync(candidate));
}

export async function renderPdf(browser: string, content: PresentationContent, title: string, assets: RenderAssets = {}): Promise<Buffer> {
  const tempRoot = resolve(tmpdir());
  const dir = await mkdtemp(join(tempRoot, "deckai-pdf-"));
  try {
    const input = join(dir, "slides.html");
    const output = join(dir, "slides.pdf");
    const printStyles = `<style>
      @page { size: 13.333in 7.5in; margin: 0; }
      @media print {
        html, body { margin: 0; padding: 0; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        .deck { display: block; }
        .deck > .slide { width: 100%; height: 7.5in; break-inside: avoid; break-after: page; }
        .deck > .slide:last-child { break-after: auto; }
      }
    </style>`;
    const html = renderPresentationDocument(content, title, assets)
      .replace("<head>", '<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">')
      .replace("</head>", `${printStyles}</head>`);
    await writeFile(input, html, "utf8");
    await runBrowser(browser, [
      "--headless", "--disable-gpu", "--disable-background-networking", "--no-first-run",
      "--no-pdf-header-footer", `--user-data-dir=${join(dir, "profile")}`,
      `--print-to-pdf=${output}`, pathToFileURL(input).href
    ], { timeout: 35_000, windowsHide: true });
    const size = (await stat(output)).size;
    if (size > maxPdfBytes || size < 5) throw new Error("PDF_SIZE_INVALID");
    const pdf = await readFile(output);
    if (pdf.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("PDF_INVALID");
    return pdf;
  } finally {
    if (dirname(resolve(dir)) === tempRoot && basename(dir).startsWith("deckai-pdf-")) {
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
}
