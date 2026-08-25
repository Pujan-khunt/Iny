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
        "Search the SST college policy database for information about academic policies, procedures, and campus operations. Use this tool when students ask about college policies, procedures, or official information.",
      parameters: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description:
              "The search query about college policies or procedures (e.g., 'SEV policy', 'how to get bonafide certificate')",
          },
          threshold: {
            type: "number",
            description:
              "Optional: Similarity threshold (0-1, default 0.35) for matching relevance. Use higher values (0.5+) for exact matches.",
          },
        },
        required: ["query"],
      },
    },
  },
];
