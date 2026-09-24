import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryToolRegistry } from '../../../../src/adapters/outbound/tool-registry/InMemoryToolRegistry';
import { Tool } from '../../../../src/core/ports/ToolRegistryPort';
import { LoggerPort } from '../../../../src/core/ports/LoggerPort';

describe('InMemoryToolRegistry', () => {
  let registry: InMemoryToolRegistry;
  let dummyTool: Tool;

  beforeEach(() => {
    registry = new InMemoryToolRegistry();
    dummyTool = {
      name: 'test_tool',
      description: 'A test tool',
      schema: { type: 'object', properties: {} },
      execute: vi.fn().mockResolvedValue('tool success result'),
    };
  });

  it('should register a tool and return pure metadata without execute property in getToolDefinitions', () => {
    registry.register(dummyTool);

    const definitions = registry.getToolDefinitions();
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toEqual({
      name: 'test_tool',
      description: 'A test tool',
      schema: { type: 'object', properties: {} },
    });
    expect((definitions[0] as unknown as Record<string, unknown>).execute).toBeUndefined();
  });

  it('should throw an error when registering a duplicate tool name', () => {
    registry.register(dummyTool);

    expect(() => registry.register(dummyTool)).toThrow(
      "Tool with name 'test_tool' is already registered."
    );
  });

  it('should execute a registered tool with provided arguments without duplicate logging', async () => {
    const mockLogger: LoggerPort = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const loggingRegistry = new InMemoryToolRegistry(mockLogger);
    loggingRegistry.register(dummyTool);

    const result = await loggingRegistry.executeTool('test_tool', { key: 'value' });
    expect(dummyTool.execute).toHaveBeenCalledWith({ key: 'value' });
    expect(result).toBe('tool success result');
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('should throw an error if tool is not found', async () => {
    await expect(registry.executeTool('unknown_tool', {})).rejects.toThrow(
      'Tool "unknown_tool" not found.'
    );
  });

  it('should let execution errors bubble up directly without catch-and-rethrow logging', async () => {
    const mockLogger: LoggerPort = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const loggingRegistry = new InMemoryToolRegistry(mockLogger);
    const failingTool: Tool = {
      name: 'failing_tool',
      description: 'Fails execution',
      schema: {},
      execute: vi.fn().mockRejectedValue(new Error('Internal tool failure')),
    };

    loggingRegistry.register(failingTool);

    await expect(loggingRegistry.executeTool('failing_tool', {})).rejects.toThrow('Internal tool failure');
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('should log debug message on tool registration when logger is provided', () => {
    const mockLogger: LoggerPort = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const loggingRegistry = new InMemoryToolRegistry(mockLogger);
    loggingRegistry.register(dummyTool);

    expect(mockLogger.debug).toHaveBeenCalledWith('Tool registered', { toolName: 'test_tool' });
  });
});
