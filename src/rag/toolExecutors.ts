/**
 * Tool Executors: Implementation of tools that the agent can call
 * Each tool maps to a TypeScript function that performs the actual work
 */

import pino from "pino";
import { retrieveTopK } from "./retrieve.js";
import type { RetrievedChunk } from "../services/sourceCache.js";

const logger = pino();

export interface ToolExecutor {
  (args: Record<string, unknown>): Promise<string>;
}

export interface ToolExecutorContext {
  getLastToolExecutionChunks: () => RetrievedChunk[];
  clearLastToolExecutionChunks: () => void;
  search_policy_database: (query: string, threshold?: number) => Promise<string>;
}

/**
 * Create a request-scoped tool executor context
 * This ensures no race conditions between concurrent requests
 */
export function createToolExecutors(): ToolExecutorContext {
  let lastToolExecutionChunks: RetrievedChunk[] = [];

  function getLastToolExecutionChunks(): RetrievedChunk[] {
    return lastToolExecutionChunks;
  }

  function clearLastToolExecutionChunks(): void {
    lastToolExecutionChunks = [];
  }

  async function search_policy_database(
    query: string,
    threshold?: number
  ): Promise<string> {
    try {
      const chunks = await retrieveTopK(query, {
        threshold: threshold ?? 0.35,
        topK: 5,
      });

      if (chunks.length === 0) {
        lastToolExecutionChunks = [];
        return JSON.stringify({
          success: false,
          message: "No matching documents found",
          results: [],
        });
      }

      // Store raw chunks for agent to retrieve
      lastToolExecutionChunks = chunks;

      // Format results for LLM consumption
      const formattedResults = chunks.map((chunk, index) => ({
        index: index + 1,
        content: chunk.content,
        source: chunk.title,
        pages: `p.${chunk.pageStart}${chunk.pageEnd !== chunk.pageStart ? `-${chunk.pageEnd}` : ""
          }`,
      }));

      // Also keep raw chunks in response (for documentation)
      const response = {
        success: true,
        message: `Found ${chunks.length} matching document(s)`,
        results: formattedResults,
      };

      return JSON.stringify(response);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      lastToolExecutionChunks = [];

      logger.error(
        { error: errorMessage, query },
        "Tool executor error: search_policy_database"
      );

      return JSON.stringify({
        success: false,
        message: `Error searching database: ${errorMessage}`,
        results: [],
      });
    }
  }

  return {
    getLastToolExecutionChunks,
    clearLastToolExecutionChunks,
    search_policy_database,
  };
}

// Default singleton for backward compatibility
let defaultToolExecutors: ToolExecutorContext | null = null;

function getDefaultToolExecutors(): ToolExecutorContext {
  if (!defaultToolExecutors) {
    defaultToolExecutors = createToolExecutors();
  }
  return defaultToolExecutors;
}

/**
 * Legacy search_policy_database function for backward compatibility
 * This uses the default singleton context
 */
export async function search_policy_database(
  query: string,
  threshold?: number
): Promise<string> {
  const executors = getDefaultToolExecutors();
  return executors.search_policy_database(query, threshold);
}

/**
 * Get chunks from last tool execution (legacy)
 */
export function getLastToolExecutionChunks(): RetrievedChunk[] {
  const executors = getDefaultToolExecutors();
  return executors.getLastToolExecutionChunks();
}

/**
 * Clear chunks after retrieval (legacy)
 */
export function clearLastToolExecutionChunks(): void {
  const executors = getDefaultToolExecutors();
  executors.clearLastToolExecutionChunks();
}

/**
 * Map tool names to their executor functions
 * This is used by the agent to route tool calls
 */
export const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  search_policy_database: (args: Record<string, unknown>) =>
    search_policy_database(args.query as string, args.threshold as number | undefined),
};
