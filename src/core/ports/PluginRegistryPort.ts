export interface Plugin {
  name: string;
  description: string;
  schema: Record<string, any>;
  execute(args: any): Promise<string>;
}

export interface PluginRegistryPort {
  getAvailablePlugins(): Plugin[];
  executePlugin(name: string, args: any): Promise<string>;
}
