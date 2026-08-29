/**
 * Tool Executors: Implementation of tools that the agent can call.
 *
 * Each executor returns a `ToolExecutionResult` containing:
 *   - `content`: a JSON string the LLM reads as the tool result
 *   - `chunks`: the raw retrieved chunks for source caching (may be empty)
 *
 * Call `createToolExecutors()` once per `runAgent` invocation so that
 * each request has its own isolated state — no shared mutable globals.
 */

import { getLogger } from "../logger.js";
import { retrieveTopK, type RetrievedChunk } from "./retrieve.js";

const logger = getLogger("tool-executors");

export interface ToolExecutionResult {
  /** JSON string to include in the LLM message history as the tool result */
  content: string;
  /** Raw retrieved chunks, used for source caching. Empty if no results. */
  chunks: RetrievedChunk[];
}

export interface ToolExecutor {
  (args: Record<string, unknown>): Promise<ToolExecutionResult>;
}

async function searchPolicyDatabase(
  query: string,
  threshold?: number,
): Promise<ToolExecutionResult> {
  try {
    const chunks = await retrieveTopK(query, {
      threshold: threshold ?? 0.35,
      topK: 5,
    });

    if (chunks.length === 0) {
      return {
        content: JSON.stringify({
          success: false,
          message:
            "No matching documents found for this query. If looking for a specific topic, try reformulating with core keywords or policy names.",
          results: [],
        }),
        chunks: [],
      };
    }

    const formattedResults = chunks.map((chunk, index) => ({
      index: index + 1,
      content: chunk.content,
      source: chunk.title,
      pages: `p.${chunk.pageStart}${chunk.pageEnd !== chunk.pageStart ? `-${chunk.pageEnd}` : ""}`,
      matchType: chunk.matchType ?? "semantic",
    }));

    return {
      content: JSON.stringify({
        success: true,
        message: `Found ${chunks.length} matching document(s)`,
        results: formattedResults,
      }),
      chunks,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    logger.error({ error: errorMessage, query }, "Tool executor error: search_policy_database");

    return {
      content: JSON.stringify({
        success: false,
        message: `Error searching database: ${errorMessage}`,
        results: [],
      }),
      chunks: [],
    };
  }
}

/**
 * Create a fresh set of tool executors for a single agent request.
 * Must be called once per `runAgent` invocation to ensure isolation.
 */
export function createToolExecutors(): Record<string, ToolExecutor> {
  return {
    search_policy_database: (args) =>
      searchPolicyDatabase(
        args.query as string,
        args.threshold as number | undefined,
      ),
  };
}
