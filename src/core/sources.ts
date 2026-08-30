/**
 * Core Source & Citation Service
 *
 * Tracks retrieved source chunks per session and provides
 * structured citation builders for any presentation channel.
 */

import NodeCache from "@cacheable/node-cache";
import { SOURCE_CACHE_TTL_MS } from "../config.js";
import { getLogger } from "../logger.js";
import type { RetrievedChunk, SourceCitation } from "./types.js";

const logger = getLogger("core-sources");

export interface CachedSources {
  sessionId: string;
  chunks: RetrievedChunk[];
  timestamp: number;
}

const sourceCache = new NodeCache({
  stdTTL: Math.max(1, Math.round(SOURCE_CACHE_TTL_MS / 1000)),
  checkperiod: 120,
  useClones: false,
});

/**
 * Stores retrieved source chunks for a session.
 */
export function cacheSources(sessionId: string, chunks: RetrievedChunk[]): void {
  const now = Date.now();
  sourceCache.set(sessionId, {
    sessionId,
    chunks,
    timestamp: now,
  });

  logger.debug(
    { sessionId, chunkCount: chunks.length },
    "Sources cached for session",
  );
}

/**
 * Retrieves the latest cached source chunks for a session.
 */
export function getSources(sessionId: string): RetrievedChunk[] {
  const cached = sourceCache.get(sessionId) as CachedSources | undefined;
  return cached?.chunks ?? [];
}

/**
 * Clears cached sources for a session.
 */
export function clearSources(sessionId: string): void {
  sourceCache.del(sessionId);
}

/**
 * Builds structured citation objects from retrieved chunks.
 */
export function buildCitations(chunks: RetrievedChunk[]): SourceCitation[] {
  if (!chunks || chunks.length === 0) {
    return [];
  }

  // Group chunks by document title
  const groupedByTitle = new Map<string, RetrievedChunk[]>();
  for (const chunk of chunks) {
    if (!groupedByTitle.has(chunk.title)) {
      groupedByTitle.set(chunk.title, []);
    }
    groupedByTitle.get(chunk.title)!.push(chunk);
  }

  const citations: SourceCitation[] = [];
  let index = 1;

  for (const [title, docChunks] of groupedByTitle.entries()) {
    const pages = new Set<string>();
    let minPage = Number.MAX_SAFE_INTEGER;
    let maxPage = 0;

    for (const chunk of docChunks) {
      if (chunk.pageStart < minPage) minPage = chunk.pageStart;
      if (chunk.pageEnd > maxPage) maxPage = chunk.pageEnd;

      if (chunk.pageStart === chunk.pageEnd) {
        pages.add(`p. ${chunk.pageStart}`);
      } else {
        pages.add(`pp. ${chunk.pageStart}-${chunk.pageEnd}`);
      }
    }

    const firstChunk = docChunks[0]!;
    const preview = firstChunk.content
      .split("\n")
      .slice(0, 2)
      .join(" ")
      .substring(0, 150)
      .trim();

    citations.push({
      index: index++,
      title,
      pageStart: minPage === Number.MAX_SAFE_INTEGER ? 1 : minPage,
      pageEnd: maxPage === 0 ? 1 : maxPage,
      pageString: Array.from(pages).join(", "),
      preview: preview.length > 0 ? `${preview}...` : "",
      fullContent: docChunks.map((c) => c.content).join("\n\n---\n\n"),
    });
  }

  return citations;
}
