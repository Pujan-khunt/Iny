import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryPluginRegistry } from '../../../../src/adapters/outbound/plugin-registry/InMemoryPluginRegistry';
import { Plugin } from '../../../../src/core/ports/PluginRegistryPort';
import { LoggerPort } from '../../../../src/core/ports/LoggerPort';

describe('InMemoryPluginRegistry', () => {
  let registry: InMemoryPluginRegistry;
  let dummyPlugin: Plugin;

  beforeEach(() => {
    registry = new InMemoryPluginRegistry();
    dummyPlugin = {
      name: 'test_tool',
      description: 'A test tool',
      schema: { type: 'object', properties: {} },
      execute: vi.fn().mockResolvedValue('tool success result'),
    };
  });

  it('should register a plugin and list it in getAvailablePlugins', () => {
    registry.register(dummyPlugin);

    const available = registry.getAvailablePlugins();
    expect(available).toHaveLength(1);
    expect(available[0]).toEqual(dummyPlugin);
  });

  it('should throw an error when registering a duplicate plugin name', () => {
    registry.register(dummyPlugin);

    expect(() => registry.register(dummyPlugin)).toThrow(
      "Plugin with name 'test_tool' is already registered."
    );
  });

  it('should execute a registered plugin with provided arguments', async () => {
    registry.register(dummyPlugin);

    const result = await registry.executePlugin('test_tool', { key: 'value' });
    expect(dummyPlugin.execute).toHaveBeenCalledWith({ key: 'value' });
    expect(result).toBe('tool success result');
  });

  it('should throw an error if plugin is not found', async () => {
    await expect(registry.executePlugin('unknown_tool', {})).rejects.toThrow(
      'Tool "unknown_tool" not found.'
    );
  });

  it('should log and rethrow error if plugin execution throws', async () => {
    const failingPlugin: Plugin = {
      name: 'failing_tool',
      description: 'Fails on execution',
      schema: {},
      execute: vi.fn().mockRejectedValue(new Error('Internal failure')),
    };

    registry.register(failingPlugin);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(registry.executePlugin('failing_tool', {})).rejects.toThrow('Internal failure');

    expect(consoleSpy).toHaveBeenCalledWith("Error executing plugin 'failing_tool':", expect.any(Error));
    consoleSpy.mockRestore();
  });

  it('should log and rethrow when plugin rejects with a plain string', async () => {
    const stringRejectPlugin: Plugin = {
      name: 'string_reject_tool',
      description: 'Rejects with a string',
      schema: {},
      execute: vi.fn().mockRejectedValue('Custom string error'),
    };

    registry.register(stringRejectPlugin);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(registry.executePlugin('string_reject_tool', {})).rejects.toBe('Custom string error');

    expect(consoleSpy).toHaveBeenCalledWith("Error executing plugin 'string_reject_tool':", 'Custom string error');
    consoleSpy.mockRestore();
  });

  it('should log registration and execution error when optional logger is provided', async () => {
    const mockLogger: LoggerPort = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const registry = new InMemoryPluginRegistry(mockLogger);
    const failingPlugin: Plugin = {
      name: 'fail',
      description: 'fails',
      schema: {},
      execute: vi.fn().mockRejectedValue(new Error('Boom')),
    };

    registry.register(failingPlugin);
    expect(mockLogger.debug).toHaveBeenCalledWith('Plugin registered', { pluginName: 'fail' });

    await expect(registry.executePlugin('fail', {})).rejects.toThrow('Boom');
    expect(mockLogger.error).toHaveBeenCalledWith("Error executing plugin 'fail'", expect.any(Error));
  });
});

