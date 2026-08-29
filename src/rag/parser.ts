import { spawn } from "node:child_process";

export interface ParsedPage {
  pageNumber: number;
  text: string;
}

export interface ParsedDocument {
  title: string;
  pages: ParsedPage[];
  fullText: string;
}

export async function parsePdf(data: Buffer | Uint8Array): Promise<ParsedDocument> {
  const buffer = data instanceof Buffer ? data : Buffer.from(data);

  // Write to temp file
  const { writeFile, unlink, mkdtemp } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const tmpDir = await mkdtemp("/tmp/pdf-");
  const tmpPath = join(tmpDir, "input.pdf");

  await writeFile(tmpPath, buffer);

  try {
    // Extract text with page numbers
    const text = await runPdftotext(tmpPath);

    // Extract title from first page or use fallback
    const title = extractTitle(text) || "Master Policy";

    // Split into pages
    const pages = splitIntoPages(text);
    const fullText = pages.map(p => p.text).join("\n\n");

    return { title, pages, fullText: normalizeText(fullText) };
  } finally {
    await unlink(tmpPath).catch(() => { });
  }
}

function runPdftotext(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("pdftotext", ["-layout", "-nopgbrk", filePath, "-"]);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`pdftotext failed: ${stderr}`));
      }
    });

    proc.on("error", reject);
  });
}

function extractTitle(text: string): string | null {
  const lines = text.split("\n").map(l => l.trim()).filter((l): l is string => Boolean(l));
  if (lines.length > 0) {
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const line = lines[i]!;
      if (line.length > 5 && line.length < 100) {
        return line;
      }
    }
    return lines[0]!;
  }
  return null;
}

function splitIntoPages(text: string): Array<{ pageNumber: number; text: string }> {
  // pdftotext with -nopgbrk doesn't add form feeds, so we'll split by form feed if present
  const formFeedSplit = text.split(/\f/);
  if (formFeedSplit.length > 1) {
    return formFeedSplit.map((t, i) => ({
      pageNumber: i + 1,
      text: normalizeText(t),
    }));
  }

  // Approximate pages by splitting on double newlines or length
  const targetPageLength = 3000;
  const pages: Array<{ pageNumber: number; text: string }> = [];
  let remaining = text;
  let pageNum = 1;

  while (remaining.length > 0) {
    const chunk = remaining.slice(0, targetPageLength);
    const lastNewline = chunk.lastIndexOf("\n");
    const pageText = lastNewline > targetPageLength * 0.5 ? chunk.slice(0, lastNewline) : chunk;
    pages.push({ pageNumber: pageNum++, text: normalizeText(pageText) });
    remaining = remaining.slice(pageText.length);
  }

  return pages;
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
