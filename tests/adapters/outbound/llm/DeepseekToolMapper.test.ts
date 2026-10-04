import { describe, it, expect } from 'vitest';
import { mapToolDefinitionsToOpenAI } from '../../../../src/adapters/outbound/llm/DeepseekToolMapper';
import { ToolDefinition } from '../../../../src/core/ports/ToolRegistryPort';

describe('DeepseekToolMapper', () => {
  it('should return undefined when tools array is empty', () => {
    const result = mapToolDefinitionsToOpenAI([]);
    expect(result).toBeUndefined();
  });

  it('should return undefined when forcedSynthesis is true', () => {
    const tools: ToolDefinition[] = [
      { name: 'calc', description: 'math', schema: { type: 'object' } },
    ];
    const result = mapToolDefinitionsToOpenAI(tools, true);
    expect(result).toBeUndefined();
  });

  it('should map tool definitions to OpenAI tool format', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'calc',
        description: 'Calculates math expressions',
        schema: { type: 'object', properties: { expr: { type: 'string' } } },
      },
    ];
    const result = mapToolDefinitionsToOpenAI(tools, false);
    expect(result).toEqual([
      {
        type: 'function',
        function: {
          name: 'calc',
          description: 'Calculates math expressions',
          parameters: { type: 'object', properties: { expr: { type: 'string' } } },
        },
      },
    ]);
  });
});
