import { describe, it, expect } from 'vitest';
import { parseOpenAIResponse } from '../../../../src/adapters/outbound/llm/DeepseekResponseParser';
import { LLMResponseError } from '../../../../src/core/errors/LLMErrors';

describe('DeepseekResponseParser', () => {
  it('should parse text response with reasoning_content thought', () => {
    const raw: any = {
      choices: [
        {
          finish_reason: 'stop',
          message: { content: 'Hello', reasoning_content: 'Thought trace' },
        },
      ],
    };
    const parsed = parseOpenAIResponse(raw);
    expect(parsed).toEqual({
      type: 'text',
      content: 'Hello',
      thought: 'Thought trace',
    });
  });

  it('should parse text response without reasoning_content', () => {
    const raw: any = {
      choices: [
        {
          finish_reason: 'stop',
          message: { content: 'Hello world' },
        },
      ],
    };
    const parsed = parseOpenAIResponse(raw);
    expect(parsed).toEqual({
      type: 'text',
      content: 'Hello world',
      thought: undefined,
    });
  });

  it('should parse tool calls with valid JSON arguments into ValidToolCall', () => {
    const raw: any = {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            reasoning_content: 'Need to compute',
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'calc', arguments: '{"expr":"2+2"}' },
              },
            ],
          },
        },
      ],
    };
    const parsed = parseOpenAIResponse(raw);
    expect(parsed.type).toBe('tool_calls');
    if (parsed.type === 'tool_calls') {
      expect(parsed.thought).toBe('Need to compute');
      expect(parsed.toolCalls).toEqual([
        {
          type: 'valid',
          id: 'c1',
          name: 'calc',
          arguments: { expr: '2+2' },
        },
      ]);
    }
  });

  it('should parse tool call with empty arguments into ValidToolCall with empty object', () => {
    const raw: any = {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'calc', arguments: '' },
              },
            ],
          },
        },
      ],
    };
    const parsed = parseOpenAIResponse(raw);
    expect(parsed.type).toBe('tool_calls');
    if (parsed.type === 'tool_calls') {
      expect(parsed.toolCalls[0]).toEqual({
        type: 'valid',
        id: 'c1',
        name: 'calc',
        arguments: {},
      });
    }
  });

  it('should parse malformed JSON arguments into MalformedToolCall without throwing', () => {
    const raw: any = {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            tool_calls: [
              {
                id: 'c2',
                type: 'function',
                function: { name: 'calc', arguments: '{"expr": 2+' },
              },
            ],
          },
        },
      ],
    };
    const parsed = parseOpenAIResponse(raw);
    expect(parsed.type).toBe('tool_calls');
    if (parsed.type === 'tool_calls') {
      expect(parsed.toolCalls[0]).toMatchObject({
        type: 'malformed',
        id: 'c2',
        name: 'calc',
        rawArguments: '{"expr": 2+',
      });
      expect((parsed.toolCalls[0] as any).parseError).toBeDefined();
    }
  });

  it('should treat non-object JSON tool arguments as MalformedToolCall', () => {
    const raw: any = {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            tool_calls: [
              {
                id: 'c3',
                type: 'function',
                function: { name: 'calc', arguments: '"just a string"' },
              },
            ],
          },
        },
      ],
    };
    const parsed = parseOpenAIResponse(raw);
    expect(parsed.type).toBe('tool_calls');
    if (parsed.type === 'tool_calls') {
      expect(parsed.toolCalls[0].type).toBe('malformed');
    }
  });

  it('should throw LLMResponseError if choices array is empty or message is missing', () => {
    expect(() => parseOpenAIResponse({ choices: [] } as any)).toThrow(LLMResponseError);
    expect(() => parseOpenAIResponse({} as any)).toThrow(LLMResponseError);
  });
});
