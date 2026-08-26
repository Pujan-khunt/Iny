/**
 * Source Formatter: Converts cached sources to detailed WhatsApp format
 */

import type { RetrievedChunk } from "../services/sourceCache.js";

/**
 * Format sources for detailed display in WhatsApp
 * Groups by document title, shows page numbers and content previews
 */
export function formatSourcesForWhatsApp(chunks: RetrievedChunk[]): string {
  if (!chunks || chunks.length === 0) {
    return "No sources available for this response.";
  }

  // Group chunks by title
  const groupedByTitle = new Map<string, RetrievedChunk[]>();
  for (const chunk of chunks) {
    if (!groupedByTitle.has(chunk.title)) {
      groupedByTitle.set(chunk.title, []);
    }
    groupedByTitle.get(chunk.title)!.push(chunk);
  }

  // Format output
  let output = "*Sources:*\n\n";

  Array.from(groupedByTitle.entries()).forEach(([title, groupedChunks], index) => {
    // Get unique pages
    const pages = new Set<string>();
    for (const chunk of groupedChunks) {
      if (chunk.pageStart === chunk.pageEnd) {
        pages.add(`p.${chunk.pageStart}`);
      } else {
        pages.add(`p.${chunk.pageStart}-${chunk.pageEnd}`);
      }
    }
    const pageString = Array.from(pages).join(", ");

    // Format this source entry
    output += `${index + 1}. *${title}*\n`;
    output += `   Pages: ${pageString}\n`;

    // Add first chunk content as preview (max 2 lines)
    const firstChunk = groupedChunks[0];
    if (firstChunk) {
      const preview = firstChunk.content
        .split("\n")
        .slice(0, 2)
        .join(" ")
        .substring(0, 150);
      output += `   "${preview}..."\n`;
    }

    output += "\n";
  });

  return output.trim();
}

/**
 * Check if user is asking for sources
 * Returns true if message contains source-related keywords
 */
export function isAskingForSources(text: string): boolean {
  const keywords = [
    "source",
    "sources",
    "where from",
    "where'd you get",
    "where did you get",
    "reference",
    "references",
    "cite",
    "citation",
    "citations",
    "evidence",
    "proof",
    "link",
    "links",
    "document",
    "documents",
    "page",
    "pages",
    "show me",
    "tell me where",
  ];

  const lowerText = text.toLowerCase().trim();

  // Check for keywords
  for (const keyword of keywords) {
    if (lowerText.includes(keyword)) {
      return true;
    }
  }

  return false;
}
