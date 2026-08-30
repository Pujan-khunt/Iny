/**
 * Iny Core RAG Engine
 *
 * The central, channel-agnostic API for the Iny assistant.
 * Can be called by any frontend adapter (WhatsApp, Web, REST API, CLI).
 */

import { executeAgent } from "./agent.js";
import { appendTurn, clearSessionMemory, getSessionHistory } from "./memory.js";
import { buildCitations, cacheSources, clearSources, getSources } from "./sources.js";
import { DEFAULT_RESPONSE_STYLE } from "../config.js";
import type { ChatRequest, ChatResponse, RetrievedChunk } from "./types.js";

/**
 * Primary entry point for querying the Iny RAG Engine.
 *
 * Automatically manages:
 * - Multi-turn conversational memory retrieval
 * - Agentic tool execution loop (hybrid vector + text policy retrieval)
 * - Source caching and citation structuring
 * - Session history updates
 * - Dynamic response style selection
 */
export async function askIny(request: ChatRequest): Promise<ChatResponse> {
  const sessionId = request.sessionId.trim();
  const userMessage = request.message.trim();
  const selectedStyle = request.style || DEFAULT_RESPONSE_STYLE;

  // 1. Retrieve prior session history
  const history = getSessionHistory(sessionId);

  // 2. Execute core agent loop with selected response style
  const result = await executeAgent(
    userMessage,
    history,
    selectedStyle,
    request.customStylePrompt,
  );

  // 3. Cache sources for later citation requests
  if (result.sources.length > 0) {
    cacheSources(sessionId, result.sources);
  }

  // 4. Update multi-turn session memory
  appendTurn(sessionId, userMessage, result.message);

  // 5. Build structured citations
  const citations = buildCitations(result.sources);

  return {
    message: result.message,
    sources: result.sources,
    citations,
    iterations: result.iterations,
    sessionId,
    style: selectedStyle,
  };
}

/**
 * Retrieve the latest cached source chunks for an active session.
 */
export function getSessionSources(sessionId: string): RetrievedChunk[] {
  return getSources(sessionId);
}

/**
 * Resets/clears conversation memory and cached sources for a session.
 */
export function resetSession(sessionId: string): void {
  clearSessionMemory(sessionId);
  clearSources(sessionId);
}

export * from "./types.js";
