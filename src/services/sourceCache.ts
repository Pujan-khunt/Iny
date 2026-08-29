/**
 * Source Cache Service: Stores retrieved sources per user (in-memory with TTL)
 *
 * Tracks the sources used in the last bot response for each user.
 * When users ask for sources, we retrieve from this cache.
 */

import NodeCache from "@cacheable/node-cache";
import pino from "pino";
import { SOURCE_CACHE_TTL_MS } from "../config.js";
import type { RetrievedChunk } from "../rag/retrieve.js";

export type { RetrievedChunk };

export interface CachedSources {
  userJid: string;
  chunks: RetrievedChunk[];
  timestamp: number;
}

const logger = pino();

const sourceCache = new NodeCache({
  stdTTL: Math.max(1, Math.round(SOURCE_CACHE_TTL_MS / 1000)),
  checkperiod: 120,
  useClones: false,
});

/**
 * Store sources for a user (latest response)
 * Overwrites previous sources for this user (only last response)
 */
export function cacheSourcesForUser(
  userJid: string,
  chunks: RetrievedChunk[]
): void {
  const now = Date.now();
  sourceCache.set(userJid, {
    userJid,
    chunks,
    timestamp: now,
  });

  logger.debug(
    { userJid, chunkCount: chunks.length },
    "Sources cached for user"
  );
}

/**
 * Retrieve cached sources for a user
 * Returns null if no sources found or cache expired
 */
export function getSourcesForUser(userJid: string): CachedSources | null {
  const cached = sourceCache.get(userJid) as CachedSources | undefined;

  if (!cached) {
    logger.debug({ userJid }, "No cached sources found for user");
    return null;
  }

  logger.debug(
    {
      userJid,
      chunkCount: cached.chunks.length,
      ageMs: Date.now() - cached.timestamp,
    },
    "Retrieved cached sources for user"
  );

  return cached;
}

/**
 * Clear sources for a user
 */
export function clearSourcesForUser(userJid: string): void {
  sourceCache.del(userJid);
  logger.debug({ userJid }, "Sources cleared for user");
}

/**
 * Get cache stats (for debugging)
 */
export function getCacheStats(): {
  keys: number;
  hits: number;
  misses: number;
} {
  const stats = sourceCache.getStats();
  return {
    keys: sourceCache.keys().length,
    hits: stats.hits,
    misses: stats.misses,
  };
}
