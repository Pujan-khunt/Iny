import NodeCache from "@cacheable/node-cache";
import { SESSION_MEMORY_MAX_MESSAGES, SESSION_MEMORY_TTL_MS } from "../config.js";
import { getLogger } from "../logger.js";
import type { ConversationTurn } from "./types.js";

const logger = getLogger("core-memory");

export interface SessionMemoryStore {
  getSessionHistory(sessionId: string): ConversationTurn[];
  appendTurn(sessionId: string, userMessage: string, assistantReply: string): void;
  clearSessionMemory(sessionId: string): void;
  getSessionMemoryStats(): { activeSessions: number; hits: number; misses: number };
}

export function createSessionMemoryStore(opts?: { maxMessages?: number; ttlMs?: number }): SessionMemoryStore {
  const maxMessages = opts?.maxMessages ?? SESSION_MEMORY_MAX_MESSAGES;
  const ttlMs = opts?.ttlMs ?? SESSION_MEMORY_TTL_MS;

  const memoryCache = new NodeCache({
    stdTTL: Math.max(1, Math.round(ttlMs / 1000)),
    checkperiod: 120,
    useClones: false,
  });

  return {
    getSessionHistory(sessionId: string): ConversationTurn[] {
      const history = memoryCache.get(sessionId) as ConversationTurn[] | undefined;
      if (!history || history.length === 0) {
        return [];
      }
      logger.debug(
        { sessionId, messageCount: history.length },
        "Retrieved session conversation history",
      );
      return [...history];
    },
    appendTurn(sessionId: string, userMessage: string, assistantReply: string): void {
      const existing = (memoryCache.get(sessionId) as ConversationTurn[] | undefined) ?? [];
      const updated: ConversationTurn[] = [
        ...existing,
        { role: "user", content: userMessage },
        { role: "assistant", content: assistantReply },
      ];
      const trimmed = updated.slice(-maxMessages);
      memoryCache.set(sessionId, trimmed);
      logger.debug(
        {
          sessionId,
          totalTurns: trimmed.length / 2,
          maxAllowed: maxMessages,
        },
        "Updated session history with new turn",
      );
    },
    clearSessionMemory(sessionId: string): void {
      memoryCache.del(sessionId);
      logger.debug({ sessionId }, "Session history cleared");
    },
    getSessionMemoryStats() {
      const stats = memoryCache.getStats();
      return {
        activeSessions: memoryCache.keys().length,
        hits: stats.hits,
        misses: stats.misses,
      };
    }
  };
}

const defaultStore = createSessionMemoryStore();
export const getSessionHistory = defaultStore.getSessionHistory;
export const appendTurn = defaultStore.appendTurn;
export const clearSessionMemory = defaultStore.clearSessionMemory;
export const getSessionMemoryStats = defaultStore.getSessionMemoryStats;
