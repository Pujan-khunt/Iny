/**
 * Search Policy Database Tool
 *
 * Hybrid retrieval (pgvector cosine + tsvector FTS + RRF fusion)
 * against the SST policy document chunks.
 */

import { getLogger } from "../../logger.js";
import { MAX_CHUNK_CONTENT_CHARS } from "../../config.js";
import { retrieveTopK } from "../retrieve.js";
import type { Tool, ToolExecutionResult } from "../tool.js";

const logger = getLogger("tool:search-policy");

export class SearchPolicyTool implements Tool {
  readonly name = "search_knowledge_base";

  readonly description =
    "Search the SST college knowledge base using hybrid retrieval " +
    "(semantic similarity + exact keyword matching) for information about " +
    "academic policies, disciplinary rules (e.g., demerit points, code of conduct), " +
    "points of contact (POCs), procedures, and campus operations. Use specific keywords for best results.";

  readonly parameters = {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description:
          "The search query or key terms (e.g., 'demerit points', " +
          "'SEV policy', 'IT support contact', 'leave policy')",
      },
      threshold: {
        type: "number",
        description: "Optional: Semantic similarity threshold (0-1, default 0.35).",
      },
    },
    required: ["query"],
  };

  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const query = args.query as string;
    const threshold = args.threshold as number | undefined;

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
              "No matching documents found for this query. If looking for a " +
              "specific topic, try reformulating with core keywords or policy names.",
            results: [],
          }),
          chunks: [],
        };
      }

      const formattedResults = chunks.map((chunk, index) => {
        const content =
          chunk.content.length > MAX_CHUNK_CONTENT_CHARS
            ? chunk.content.slice(0, MAX_CHUNK_CONTENT_CHARS) + "…"
            : chunk.content;
        return {
          index: index + 1,
          content,
          source: chunk.title,
          pages: `p.${chunk.pageStart}${chunk.pageEnd !== chunk.pageStart ? `-${chunk.pageEnd}` : ""}`,
          matchType: chunk.matchType ?? "semantic",
        };
      });

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
      logger.error({ error: errorMessage, query }, "search_knowledge_base failed");

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
}
