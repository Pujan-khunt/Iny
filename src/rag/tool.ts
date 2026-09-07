/**
 * Extensible Tool System
 *
 * Defines the Tool interface and ToolRegistry that the agent uses
 * to discover and execute tools. Adding a new integration:
 *   1. Create a class implementing Tool in src/rag/tools/
 *   2. Register it in createToolRegistry() in src/rag/tools/index.ts
 */

import type { RetrievedChunk } from "./retrieve.js";

/** Result returned by a tool execution */
export interface ToolExecutionResult {
  /** JSON string included in the LLM message history as the tool result */
  content: string;
  /** Raw retrieved chunks for source caching. Empty array if not applicable. */
  chunks: RetrievedChunk[];
}

/** A capability the agent can invoke via LLM tool calling */
export interface Tool {
  /** Function name the LLM will call (e.g., "search_policy_database") */
  readonly name: string;

  /** Human-readable description telling the LLM when/how to use this tool */
  readonly description: string;

  /**
   * JSON Schema object defining the tool's parameters.
   * This is passed directly to the OpenAI function calling API.
   */
  readonly parameters: Record<string, unknown>;

  /** Execute the tool with parsed arguments from the LLM */
  execute(args: Record<string, unknown>): Promise<ToolExecutionResult>;
}

/**
 * Registry of available tools.
 * The agent queries this for schemas (to send to the LLM)
 * and for executors (to run when the LLM calls a tool).
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  /** Register a tool. Throws if a tool with the same name is already registered. */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Get a tool by name, or undefined if not registered. */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** Get all registered tool names. */
  names(): string[] {
    return [...this.tools.keys()];
  }

  /** Build OpenAI-compatible tool schemas for all registered tools. */
  schemas(): Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    return [...this.tools.values()].map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }
}
