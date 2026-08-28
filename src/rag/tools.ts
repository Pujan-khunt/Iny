/**
 * Tool Schemas and Types for Agentic RAG
 */

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolResult {
  role: "tool";
  tool_call_id: string;
  name: string;
  content: string; // JSON string
}

/**
 * Tool schema definitions sent to LLM
 * These tell the LLM what tools are available and when to use them
 */
export const TOOL_SCHEMAS = [
  {
    type: "function" as const,
    function: {
      name: "search_policy_database",
      description:
        "Search the SST college policy database using hybrid retrieval (semantic similarity + exact keyword matching) for information about academic policies, disciplinary rules (e.g., demerit points, code of conduct), procedures, and campus operations. Use specific keywords or policy names for best results.",
      parameters: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description:
              "The search query or key terms (e.g., 'demerit points', 'SEV policy', 'bonafide certificate procedure', 'leave policy')",
          },
          threshold: {
            type: "number",
            description:
              "Optional: Semantic similarity threshold (0-1, default 0.35).",
          },
        },
        required: ["query"],
      },
    },
  },
];
