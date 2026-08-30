/**
 * Session Memory Service: Stores short-term conversation context per user/group.
 *
 * Provides sliding-window multi-turn memory so Iny can handle follow-ups,
 * clarifications, and referential pronouns (e.g. "How do I apply for that?").
 * Automatically expires idle conversations via TTL.
 */

import NodeCache from "@cacheable/node-cache";
import { SESSION_MEMORY_MAX_MESSAGES, SESSION_MEMORY_TTL_MS } from "../config.js";
import { getLogger } from "../logger.js";

const logger = getLogger("session-memory");

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

const memoryCache = new NodeCache({
  stdTTL: Math.max(1, Math.round(SESSION_MEMORY_TTL_MS / 1000)),
  checkperiod: 120,
  useClones: false,
});

/**
 * Retrieves the recent conversational history for a user or group participant.
 * Returns an empty array if the session does not exist or has expired.
 */
export function getSessionHistory(sessionKey: string): ConversationTurn[] {
  const history = memoryCache.get(sessionKey) as ConversationTurn[] | undefined;

  if (!history || history.length === 0) {
    logger.debug({ sessionKey }, "No active session history found");
    return [];
  }

  logger.debug(
    { sessionKey, messageCount: history.length },
    "Retrieved session conversation history",
  );

  return [...history];
}

/**
 * Appends a completed conversational exchange (user question + assistant answer)
 * to the session memory, maintaining the configured sliding window limit.
 */
export function appendTurn(
  sessionKey: string,
  userMessage: string,
  assistantReply: string,
): void {
  const existing = (memoryCache.get(sessionKey) as ConversationTurn[] | undefined) ?? [];

  const updated: ConversationTurn[] = [
    ...existing,
    { role: "user", content: userMessage },
    { role: "assistant", content: assistantReply },
  ];

  // Apply sliding window (keep last N messages)
  const trimmed = updated.slice(-SESSION_MEMORY_MAX_MESSAGES);

  // Store in cache with refreshed TTL
  memoryCache.set(sessionKey, trimmed);

  logger.debug(
    {
      sessionKey,
      totalTurns: trimmed.length / 2,
      maxAllowed: SESSION_MEMORY_MAX_MESSAGES,
    },
    "Updated session history with new turn",
  );
}

/**
 * Clears the session history for a specific conversation.
 */
export function clearSession(sessionKey: string): void {
  memoryCache.del(sessionKey);
  logger.debug({ sessionKey }, "Session history cleared");
}

/**
 * Get memory cache statistics for monitoring/debugging.
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
