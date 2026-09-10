import { executeAgent as defaultExecuteAgent } from "./agent.js";
import { appendTurn, clearSessionMemory, getSessionHistory, getSessionMemoryStats } from "./memory.js";
import { buildCitations, cacheSources, clearSources, getSources } from "./sources.js";
import { DEFAULT_RESPONSE_STYLE } from "../config.js";
import type { ChatRequest, ChatResponse, RetrievedChunk } from "./types.js";
import { createToolRegistry } from "../rag/tools/index.js";
import type { ToolRegistry } from "../rag/tool.js";
import type { Agent } from "./agent.js";
import type { SessionMemoryStore } from "./memory.js";
import type { SourceCacheStore } from "./sources.js";

export interface EngineDeps {
  agent: Pick<Agent, "executeAgent">;
  memory: SessionMemoryStore;
  sources: SourceCacheStore;
  registry: ToolRegistry;
}

export interface Engine {
  askIny(request: ChatRequest): Promise<ChatResponse>;
  getSessionSources(sessionId: string): RetrievedChunk[];
  resetSession(sessionId: string): void;
}

export function createEngine(deps: EngineDeps): Engine {
  return {
    async askIny(request: ChatRequest): Promise<ChatResponse> {
      const sessionId = request.sessionId.trim();
      const userMessage = request.message.trim();
      const selectedStyle = request.style || DEFAULT_RESPONSE_STYLE;

      const history = deps.memory.getSessionHistory(sessionId);

      const result = await deps.agent.executeAgent(
        userMessage,
        history,
        deps.registry,
        selectedStyle,
        request.customStylePrompt,
      );

      if (result.sources.length > 0) {
        deps.sources.cacheSources(sessionId, result.sources);
      }

      deps.memory.appendTurn(sessionId, userMessage, result.message);

      const citations = deps.sources.buildCitations(result.sources);

      return {
        message: result.message,
        sources: result.sources,
        citations,
        iterations: result.iterations,
        sessionId,
        style: selectedStyle,
      };
    },
    getSessionSources(sessionId: string): RetrievedChunk[] {
      return deps.sources.getSources(sessionId);
    },
    resetSession(sessionId: string): void {
      deps.memory.clearSessionMemory(sessionId);
      deps.sources.clearSources(sessionId);
    }
  };
}

const defaultRegistry = createToolRegistry();
const defaultEngine = createEngine({
  agent: { executeAgent: defaultExecuteAgent },
  memory: {
    getSessionHistory,
    appendTurn,
    clearSessionMemory,
    getSessionMemoryStats,
  },
  sources: {
    cacheSources,
    getSources,
    clearSources,
    buildCitations,
  },
  registry: defaultRegistry,
});

export const askIny = defaultEngine.askIny;
export const getSessionSources = defaultEngine.getSessionSources;
export const resetSession = defaultEngine.resetSession;
export * from "./types.js";
