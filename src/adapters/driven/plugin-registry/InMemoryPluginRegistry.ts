import { Plugin, PluginRegistryPort } from '../../../core/ports/PluginRegistryPort';
import { LoggerPort } from '../../../core/ports/LoggerPort';

export class InMemoryPluginRegistry implements PluginRegistryPort {
  private plugins = new Map<string, Plugin>();

  constructor(private logger?: LoggerPort) {}

  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin with name '${plugin.name}' is already registered.`);
    }
    this.plugins.set(plugin.name, plugin);
    this.logger?.debug('Plugin registered', { pluginName: plugin.name });
  }

  getAvailablePlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  async executePlugin(name: string, args: any): Promise<string> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Tool "${name}" not found.`);
    }

    try {
      return await plugin.execute(args);
    } catch (error: any) {
      if (this.logger) {
        this.logger.error(`Error executing plugin '${name}'`, error);
      } else {
        console.error(`Error executing plugin '${name}':`, error);
      }
      throw error;
    }
  }
}
