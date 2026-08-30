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

const KNOWN_ACRONYMS = new Set(["SOP", "SST", "TA", "PDC", "KR", "SEV", "POC"]);
const SMALL_WORDS = new Set([
  "and",
  "or",
  "for",
  "of",
  "in",
  "to",
  "on",
  "at",
  "from",
  "the",
  "a",
  "an",
  "by",
  "with",
]);

/**
 * Converts a kebab-case or snake_case PDF filename into a clean, human-readable title.
 * Examples:
 * - "academic-policy-master.pdf" -> "Academic Policy Master"
 * - "sop-meeting-room-booking.pdf" -> "SOP Meeting Room Booking"
 * - "code-of-conduct-and-violation.pdf" -> "Code of Conduct and Violation"
 */
export function formatTitleFromFilename(filename: string): string {
  const base = filename
    .replace(/^.*[\\/]/, "") // strip directory path
    .replace(/\.pdf$/i, "") // strip extension
    .replace(/[-_]+/g, " ") // replace dashes and underscores with spaces
    .trim();

  if (!base) return "Policy Document";

  const words = base.split(/\s+/);
  const formatted = words.map((word, index) => {
    const upper = word.toUpperCase();
    if (KNOWN_ACRONYMS.has(upper)) {
      return upper;
    }
    const lower = word.toLowerCase();
    if (index > 0 && SMALL_WORDS.has(lower)) {
      return lower;
    }
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });

  return formatted.join(" ");
}

export async function parsePdf(
  data: Buffer | Uint8Array,
  filePathOrName?: string,
): Promise<ParsedDocument> {
  const buffer = data instanceof Buffer ? data : Buffer.from(data);

  // Extract text with form-feed page markers via stdin stream
  const text = await runPdftotext(buffer);

  // Derive title from canonical filename or fallback to text inspection
  const title = filePathOrName
    ? formatTitleFromFilename(filePathOrName)
    : (extractTitle(text) || "Policy Document");

  // Split into true PDF pages using form feeds
  const pages = splitIntoPages(text);
  const fullText = pages.map((p) => p.text).join("\n\n");

  return { title, pages, fullText };
}

function runPdftotext(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    // Note: Omit -nopgbrk so pdftotext inserts form feeds (\f) between actual pages
    const proc = spawn("pdftotext", ["-layout", "-", "-"]);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`pdftotext failed: ${stderr}`));
      }
    });

    proc.on("error", reject);
    proc.stdin.on("error", reject);
    proc.stdin.end(buffer);
  });
}

function extractTitle(text: string): string | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l): l is string => Boolean(l));

  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i]!.replace(/[:;]+$/, "").trim();
    if (line.length > 5 && line.length < 100 && !/^objective/i.test(line)) {
      return line;
    }
  }

  return lines[0] ?? null;
}

function splitIntoPages(text: string): Array<{ pageNumber: number; text: string }> {
  // pdftotext emits form feed characters (\f) between actual PDF pages
  const formFeedPages = text
    .split(/\f/)
    .map((page) => normalizeText(page))
    .filter((page) => page.length > 0);

  if (formFeedPages.length > 0) {
    return formFeedPages.map((pageText, index) => ({
      pageNumber: index + 1,
      text: pageText,
    }));
  }

  // Fallback for single-page text
  const normalized = normalizeText(text);
  if (normalized) {
    return [{ pageNumber: 1, text: normalized }];
  }

  return [];
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
