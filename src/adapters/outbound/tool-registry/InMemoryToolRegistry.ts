/**
 * Outbound adapter implementing ToolRegistryPort using an in-memory Map.
 *
 * In Hexagonal Architecture, this adapter manages the lifecycle and execution
 * of executable tools available to domain use cases (such as AgentLoop and
 * HandleIncomingUserMessage). It strictly encapsulates internal tool instances:
 * callers discover tool capabilities via read-only ToolDefinition metadata and
 * execute tools polymorphically through executeTool.
 */

import {
	Tool,
	ToolDefinition,
	ToolRegistryPort,
	ToolResult,
} from "../../../core/ports/ToolRegistryPort";
import { LoggerPort } from "../../../core/ports/LoggerPort";

/**
 * In-memory registry for storing, discovering, and dispatching tool executions.
 */
export class InMemoryToolRegistry implements ToolRegistryPort {
	private readonly tools = new Map<string, Tool>();

	constructor(private readonly logger?: LoggerPort) {}

	/**
	 * Registers a tool instance into the registry.
	 *
	 * @param tool The executable tool to register.
	 * @throws {Error} If a tool with the same name is already registered.
	 */
	register(tool: Tool): void {
		if (this.tools.has(tool.name)) {
			throw new Error(`Tool with name '${tool.name}' is already registered.`);
		}
		this.tools.set(tool.name, tool);
		this.logger?.debug("Tool registered", { toolName: tool.name });
	}

	/**
	 * Retrieves read-only definitions for all registered tools.
	 * Extracts name, description, and JSON schema suitable for LLM prompt injection,
	 * without exposing execution logic.
	 *
	 * @returns Array of tool definitions.
	 */
	getToolDefinitions(): ToolDefinition[] {
		return Array.from(this.tools.values()).map(({ name, description, schema }) => ({
			name,
			description,
			schema,
		}));
	}

	/**
	 * Executes a registered tool by name with validated arguments.
	 *
	 * @param name Unique name of the tool to execute.
	 * @param args Dictionary of arguments supplied by the caller.
	 * @returns Structured result of tool execution.
	 * @throws {Error} If the requested tool name is not registered.
	 */
	async executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
		const tool = this.tools.get(name);
		if (!tool) {
			throw new Error(`Tool "${name}" not found.`);
		}
		return await tool.execute(args);
	}
}
