import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { BaseTool } from '../../src/tools/BaseTool';
import { ToolResult } from '../../src/core/ports/ToolRegistryPort';

const testSchema = z.object({
  query: z.string().min(1),
  count: z.number().optional(),
});

class ConcreteTestTool extends BaseTool<typeof testSchema> {
  readonly name = 'test_tool';
  readonly description = 'A test tool implementation';
  readonly schema = testSchema as typeof testSchema & Record<string, unknown>;

  constructor(private isTerminal = false) {
    super();
  }

  protected async run(args: z.infer<typeof testSchema>): Promise<ToolResult> {
    return {
      content: `Result for query: ${args.query}`,
      isTerminal: this.isTerminal,
    };
  }
}

describe('BaseTool', () => {
  it('exposes definition with JSON schema matching Zod schema', () => {
    const tool = new ConcreteTestTool();
    expect(tool.name).toBe('test_tool');
    expect(tool.description).toBe('A test tool implementation');

    const def = tool.definition;
    expect(def.name).toBe('test_tool');
    expect(def.description).toBe('A test tool implementation');
    expect(def.schema).toBeDefined();
    expect(def.schema).toHaveProperty('type', 'object');
  });

  it('validates arguments and executes abstract run() returning ToolResult', async () => {
    const tool = new ConcreteTestTool(true);
    const result = await tool.execute({ query: 'hello' });

    expect(result).toEqual({
      content: 'Result for query: hello',
      isTerminal: true,
    });
  });

  it('returns non-terminal error ToolResult when schema validation fails', async () => {
    const tool = new ConcreteTestTool();
    const result = await tool.execute({});

    expect(result.isTerminal).toBe(false);
    expect(result.content).toContain('Error: Invalid tool arguments');
  });
});
