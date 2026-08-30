/**
 * Core Session Memory Service
 *
 * Manages short-term conversation context per session.
 * Stores clean user/assistant conversational turns with sliding window
 * trimming and automatic TTL expiration via NodeCache.
 */

import NodeCache from "@cacheable/node-cache";
import { SESSION_MEMORY_MAX_MESSAGES, SESSION_MEMORY_TTL_MS } from "../config.js";
import { getLogger } from "../logger.js";
import type { ConversationTurn } from "./types.js";

const logger = getLogger("core-memory");

const memoryCache = new NodeCache({
  stdTTL: Math.max(1, Math.round(SESSION_MEMORY_TTL_MS / 1000)),
  checkperiod: 120,
  useClones: false,
});

/**
 * Retrieves the recent conversational history for a session.
 * Returns an empty array if no active history exists.
 */
export function getSessionHistory(sessionId: string): ConversationTurn[] {
  const history = memoryCache.get(sessionId) as ConversationTurn[] | undefined;

  if (!history || history.length === 0) {
    return [];
  }

  logger.debug(
    { sessionId, messageCount: history.length },
    "Retrieved session conversation history",
  );

  return [...history];
}

/**
 * Appends a completed conversational exchange to session memory.
 */
export function appendTurn(
  sessionId: string,
  userMessage: string,
  assistantReply: string,
): void {
  const existing = (memoryCache.get(sessionId) as ConversationTurn[] | undefined) ?? [];

  const updated: ConversationTurn[] = [
    ...existing,
    { role: "user", content: userMessage },
    { role: "assistant", content: assistantReply },
  ];

  // Apply sliding window (keep last N messages)
  const trimmed = updated.slice(-SESSION_MEMORY_MAX_MESSAGES);

  memoryCache.set(sessionId, trimmed);

  logger.debug(
    {
      sessionId,
      totalTurns: trimmed.length / 2,
      maxAllowed: SESSION_MEMORY_MAX_MESSAGES,
    },
    "Updated session history with new turn",
  );
}

/**
 * Clears the session history for a conversation.
 */
export function clearSessionMemory(sessionId: string): void {
  memoryCache.del(sessionId);
  logger.debug({ sessionId }, "Session history cleared");
}

/**
 * Get memory cache statistics for monitoring.
 */
export function getSessionMemoryStats(): {
  activeSessions: number;
  hits: number;
  misses: number;
} {
  const stats = memoryCache.getStats();
  return {
    activeSessions: memoryCache.keys().length,
    hits: stats.hits,
    misses: stats.misses,
  };
}
