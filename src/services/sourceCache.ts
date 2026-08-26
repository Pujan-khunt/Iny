/**
 * Source Cache Service: Stores retrieved sources per user (in-memory)
 *
 * Tracks the sources used in the last bot response for each user.
 * When users ask for sources, we retrieve from this cache.
 */

import pino from "pino";

const logger = pino();

export interface RetrievedChunk {
  content: string;
  title: string;
  pageStart: number;
  pageEnd: number;
}

export interface CachedSources {
  userJid: string;
  chunks: RetrievedChunk[];
  timestamp: number;
}

/**
 * Per-user source cache
 * Key: userJid, Value: CachedSources
 */
const sourceCache = new Map<string, CachedSources>();

/**
 * Store sources for a user (latest response)
 * Overwrites previous sources for this user (only last response)
 */
export function cacheSourcesForUser(
  userJid: string,
  chunks: RetrievedChunk[]
): void {
  sourceCache.set(userJid, {
    userJid,
    chunks,
    timestamp: Date.now(),
  });

  logger.debug(
    { userJid, chunkCount: chunks.length, timestamp: new Date().toISOString() },
    "Sources cached for user"
  );
}

/**
 * Retrieve cached sources for a user
 * Returns null if no sources found or cache expired
 */
export function getSourcesForUser(userJid: string): CachedSources | null {
  const cached = sourceCache.get(userJid);

  if (!cached) {
    logger.debug({ userJid }, "No cached sources found for user");
    return null;
  }

  // Cache is valid (no expiration in MVP, but tracked)
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
  sourceCache.delete(userJid);
  logger.debug({ userJid }, "Sources cleared for user");
}

/**
 * Get cache stats (for debugging)
 */
export function getCacheStats(): {
  totalUsers: number;
  cacheSize: number;
} {
  return {
    totalUsers: sourceCache.size,
    cacheSize: sourceCache.size,
  };
}
