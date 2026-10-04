import { describe, it, expect } from 'vitest';
import {
  parseToolCalls,
  FunctionToolCall,
} from '../../../../src/adapters/outbound/llm/DeepseekToolCallParser';

describe('DeepseekToolCallParser', () => {
  it('should parse valid tool call with valid JSON object arguments', () => {
    const rawCalls: FunctionToolCall[] = [
      {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"location":"Tokyo","unit":"celsius"}',
        },
      },
    ];

    const result = parseToolCalls(rawCalls);
    expect(result).toEqual([
      {
        type: 'valid',
        id: 'call_1',
        name: 'get_weather',
        arguments: { location: 'Tokyo', unit: 'celsius' },
      },
    ]);
  });

  it('should parse valid tool call with empty or whitespace arguments into empty object', () => {
    const rawCalls: FunctionToolCall[] = [
      {
        id: 'call_2',
        type: 'function',
        function: {
          name: 'list_items',
          arguments: '',
        },
      },
      {
        id: 'call_3',
        type: 'function',
        function: {
          name: 'get_status',
          arguments: '   ',
        },
      },
    ];

    const result = parseToolCalls(rawCalls);
    expect(result).toEqual([
      {
        type: 'valid',
        id: 'call_2',
        name: 'list_items',
        arguments: {},
      },
      {
        type: 'valid',
        id: 'call_3',
        name: 'get_status',
        arguments: {},
      },
    ]);
  });

  it('should parse invalid JSON string into malformed tool call request', () => {
    const rawCalls: FunctionToolCall[] = [
      {
        id: 'call_4',
        type: 'function',
        function: {
          name: 'calculate',
          arguments: '{"expr": 2 + }',
        },
      },
    ];

    const result = parseToolCalls(rawCalls);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'malformed',
      id: 'call_4',
      name: 'calculate',
      rawArguments: '{"expr": 2 + }',
    });
    if (result[0].type === 'malformed') {
      expect(result[0].parseError).toBeDefined();
    }
  });

  it('should parse non-object JSON values into malformed tool call request', () => {
    const rawCalls: FunctionToolCall[] = [
      {
        id: 'call_5',
        type: 'function',
        function: {
          name: 'parse_array',
          arguments: '[1, 2, 3]',
        },
      },
      {
        id: 'call_6',
        type: 'function',
        function: {
          name: 'parse_primitive',
          arguments: '"string_arg"',
        },
      },
    ];

    const result = parseToolCalls(rawCalls);
    expect(result[0]).toEqual({
      type: 'malformed',
      id: 'call_5',
      name: 'parse_array',
      rawArguments: '[1, 2, 3]',
      parseError: 'Tool arguments must be a JSON object',
    });
    expect(result[1]).toEqual({
      type: 'malformed',
      id: 'call_6',
      name: 'parse_primitive',
      rawArguments: '"string_arg"',
      parseError: 'Tool arguments must be a JSON object',
    });
  });
});
