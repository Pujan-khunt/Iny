/**
 * Source Cache Service: Stores retrieved sources per user (in-memory)
 *
 * Tracks the sources used in the last bot response for each user.
 * When users ask for sources, we retrieve from this cache.
 */

import pino from "pino";
import { SOURCE_CACHE_TTL_MS } from "../config.js";

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
  expiresAt: number;
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
  const now = Date.now();
  sourceCache.set(userJid, {
    userJid,
    chunks,
    timestamp: now,
    expiresAt: now + SOURCE_CACHE_TTL_MS,
  });

  logger.debug(
    { userJid, chunkCount: chunks.length, expiresAt: new Date(now + SOURCE_CACHE_TTL_MS).toISOString() },
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

  // Check if cache has expired
  if (Date.now() > cached.expiresAt) {
    sourceCache.delete(userJid);
    logger.debug({ userJid }, "Cached sources expired and removed");
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
  sourceCache.delete(userJid);
  logger.debug({ userJid }, "Sources cleared for user");
}

/**
 * Get cache stats (for debugging)
 */
export function getCacheStats(): {
  totalUsers: number;
  cacheSize: number;
  activeEntries: number;
  expiredEntries: number;
} {
  const now = Date.now();
  let activeEntries = 0;
  let expiredEntries = 0;

  for (const entry of sourceCache.values()) {
    if (now > entry.expiresAt) {
      expiredEntries++;
    } else {
      activeEntries++;
    }
  }

  return {
    totalUsers: sourceCache.size,
    cacheSize: sourceCache.size,
    activeEntries,
    expiredEntries,
  };
}
