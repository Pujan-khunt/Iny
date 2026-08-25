/**
 * Tool Executors: Implementation of tools that the agent can call
 * Each tool maps to a TypeScript function that performs the actual work
 */

import pino from "pino";
import { retrieveTopK } from "./retrieve.js";

const logger = pino();

export interface ToolExecutor {
  (args: Record<string, unknown>): Promise<string>;
}

/**
 * Search policy database tool executor
 * Retrieves relevant policy documents based on user query
 * Returns JSON string with results or error for LLM consumption
 */
export async function search_policy_database(
  query: string,
  threshold?: number
): Promise<string> {
  try {
    const chunks = await retrieveTopK(query, {
      threshold: threshold ?? 0.35,
      topK: 5,
    });

    if (chunks.length === 0) {
      return JSON.stringify({
        success: false,
        message: "No matching documents found",
        results: [],
      });
    }

    // Format results for LLM consumption
    const formattedResults = chunks.map((chunk, index) => ({
      index: index + 1,
      content: chunk.content,
      source: chunk.title,
      pages: `p.${chunk.pageStart}${
        chunk.pageEnd !== chunk.pageStart ? `-${chunk.pageEnd}` : ""
      }`,
    }));

    // Also keep raw chunks for citation generation later
    const response = {
      success: true,
      message: `Found ${chunks.length} matching document(s)`,
      results: formattedResults,
      _raw_chunks: chunks, // Internal use for citations (LLM will ignore)
    };

    return JSON.stringify(response);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

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

/**
 * Map tool names to their executor functions
 * This is used by the agent to route tool calls
 */
export const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  search_policy_database: (args: Record<string, unknown>) =>
    search_policy_database(args.query as string, args.threshold as number | undefined),
};
