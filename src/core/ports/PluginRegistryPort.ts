export interface Plugin {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<string>;
}

export interface PluginRegistryPort {
  getAvailablePlugins(): Plugin[];
  executePlugin(name: string, args: Record<string, unknown>): Promise<string>;
}
