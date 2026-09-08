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
 * Converts a kebab-case or snake_case filename into a clean, human-readable title.
 * Examples:
 * - "academic-policy-master.md" -> "Academic Policy Master"
 */
export function formatTitleFromFilename(filename: string): string {
  const base = filename
    .replace(/^.*[\\/]/, "") // strip directory path
    .replace(/\.md$/i, "") // strip extension
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

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function parseMarkdown(
  data: Buffer | Uint8Array,
  filePathOrName?: string,
): Promise<ParsedDocument> {
  const text = data instanceof Buffer ? data.toString("utf8") : Buffer.from(data).toString("utf8");

  // Attempt to find a title from an H1 tag
  let title = "Markdown Document";
  const h1Match = text.match(/^#\s+(.+)$/m);
  if (h1Match && h1Match[1]) {
    title = h1Match[1].trim();
  } else if (filePathOrName) {
    title = formatTitleFromFilename(filePathOrName);
  } else {
    const extracted = extractTitle(text);
    if (extracted) title = extracted;
  }

  // Markdown doesn't have pages, so we put it all in page 1
  const normalizedText = normalizeText(text);
  const pages: ParsedPage[] = [
    {
      pageNumber: 1,
      text: normalizedText,
    }
  ];

  return { title, pages, fullText: normalizedText };
}

export async function parseFile(
  filePath: string,
  buffer: Buffer,
): Promise<ParsedDocument> {
  if (!filePath.toLowerCase().endsWith(".md")) {
    throw new Error(`Only Markdown (.md) files are supported for ingestion. Received: ${filePath}`);
  }
  return parseMarkdown(buffer, filePath);
}
