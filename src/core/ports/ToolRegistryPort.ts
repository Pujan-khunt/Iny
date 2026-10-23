/**
 * Result returned by a tool execution.
 * When isTerminal is true and all batch tools succeeded, the AgentLoop
 * terminates early without further LLM synthesis.
 */
export interface ToolResult {
	readonly content: string;
	readonly isTerminal: boolean;
}

/**
 * Read-only metadata describing a tool for LLM prompt construction.
 * Separates schema declaration from tool execution.
 */
export interface ToolDefinition {
	/** The unique name of the tool matching the model function declaration. */
	readonly name: string;
	/** Human-readable description explaining when and how to use the tool. */
	readonly description: string;
	/** JSON Schema specification describing tool parameters and types. */
	readonly schema: Record<string, unknown>;
}

/**
 * An executable tool implementation.
 * Combines metadata declaration with an asynchronous execution handler.
 */
export interface Tool extends ToolDefinition {
	/**
	 * Executes the tool logic with validated arguments.
	 *
	 * @param args Dictionary of arguments supplied by the caller.
	 * @returns Structured tool execution result.
	 */
	execute(args: Record<string, unknown>): Promise<ToolResult>;
}

/**
 * Outbound port for tool discovery and execution.
 * Allows the core domain to discover available tools and execute them safely.
 */
export interface ToolRegistryPort {
	/**
	 * Retrieves read-only definitions for all registered tools.
	 *
	 * @returns Array of tool definitions suitable for LLM prompt injection.
	 */
	getToolDefinitions(): ToolDefinition[];

	/**
	 * Executes a tool by name with the given arguments.
	 *
	 * @param name Unique name of the tool to execute.
	 * @param args Dictionary of arguments passed to the tool.
	 * @returns Structured result of the tool execution.
	 */
	executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}
