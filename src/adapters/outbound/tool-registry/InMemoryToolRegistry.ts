import { Tool, ToolDefinition, ToolRegistryPort } from '../../../core/ports/ToolRegistryPort';
import { LoggerPort } from '../../../core/ports/LoggerPort';

export class InMemoryToolRegistry implements ToolRegistryPort {
  private tools = new Map<string, Tool>();

  constructor(private logger?: LoggerPort) {}

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool with name '${tool.name}' is already registered.`);
    }
    this.tools.set(tool.name, tool);
    this.logger?.debug('Tool registered', { toolName: tool.name });
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(({ name, description, schema }) => ({
      name,
      description,
      schema,
    }));
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found.`);
    }
    return await tool.execute(args);
  }

  /** Transitional alias for backward compatibility until Task 6 refactors ProcessIncomingMessage. */
  async executePlugin(name: string, args: Record<string, unknown>): Promise<string> {
    return this.executeTool(name, args);
  }

  /** Transitional alias for backward compatibility until Task 6 refactors ProcessIncomingMessage. */
  getAvailablePlugins(): Tool[] {
    return Array.from(this.tools.values());
  }
}
