import { buildCitations, type RetrievedChunk } from "../core/index.js";

/**
 * Format sources for detailed display in WhatsApp
 * Groups by document title, shows page numbers and content previews
 */
export function formatSourcesForWhatsApp(chunks: RetrievedChunk[]): string {
  const citations = buildCitations(chunks);
  if (citations.length === 0) {
    return "No sources available for this response.";
  }

  let output = "*Sources:*\n\n";

  for (const c of citations) {
    output += `${c.index}. *${c.title}*\n`;
    output += `   Pages: ${c.pageString}\n`;
    if (c.preview) {
      output += `   "${c.preview}"\n`;
    }
    output += "\n";
  }

  return output.trim();
}

const SOURCE_PATTERNS = [
  /\b(sources?|citations?|references?|proof|evidence)\b/i,
  /\bwhere('?d| did) (you|this) (come from|get this|find this)\b/i,
  /\bwhere is (this|that) (written|mentioned|from)\b/i,
  /\bwhich (policy|document|handbook|pdf) (is this|is that|states this|from)\b/i,
  /\bshow (me )?(the )?(sources?|references?|citations?|pages?)\b/i,
  /\bwhat('?s| is) the source\b/i,
];

/**
 * Check if user is asking for sources
 * Returns true if message explicitly asks for sources, citations, or references
 */
export function isAskingForSources(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  return SOURCE_PATTERNS.some((pattern) => pattern.test(trimmed));
}
