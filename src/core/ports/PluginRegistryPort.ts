import { Tool, ToolRegistryPort } from './ToolRegistryPort';

export { Tool, ToolRegistryPort };

/**
 * Transitional type alias for Tool to preserve backward compatibility.
 *
 * @deprecated Use Tool from ToolRegistryPort instead.
 */
export type Plugin = Tool;

/**
 * Transitional outbound port for plugin discovery and execution.
 *
 * @deprecated Use ToolRegistryPort instead.
 */
export interface PluginRegistryPort {
  /**
   * Retrieves all registered plugins.
   *
   * @deprecated Use ToolRegistryPort.getToolDefinitions instead.
   */
  getAvailablePlugins(): Plugin[];

  /**
   * Executes a plugin by name with the given arguments.
   *
   * @deprecated Use ToolRegistryPort.executeTool instead.
   */
  executePlugin(name: string, args: Record<string, unknown>): Promise<string>;
}
