import { describe, it, expect } from 'vitest';
import { parseOpenAIResponse } from '../../../../src/adapters/outbound/llm/DeepseekResponseParser';
import { LLMResponseError } from '../../../../src/core/errors/LLMErrors';

describe('DeepseekResponseParser', () => {
  it('should parse text response with reasoning_content reasoning', () => {
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
      reasoning: 'Thought trace',
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
      reasoning: undefined,
    });
  });

  it('should parse tool calls with valid JSON arguments into ValidToolCallRequest', () => {
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
      expect(parsed.reasoning).toBe('Need to compute');
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

  it('should parse tool calls with both reasoning_content and natural content without conflation', () => {
    const raw: any = {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            reasoning_content: 'Let me calculate this.',
            content: 'Calculating your expression...',
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
      expect(parsed.reasoning).toBe('Let me calculate this.');
      expect(parsed.content).toBe('Calculating your expression...');
      expect(parsed.toolCalls).toHaveLength(1);
    }
  });

  it('should not treat natural content as reasoning when reasoning_content is absent in tool calls', () => {
    const raw: any = {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: 'I will now run the search.',
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'search', arguments: '{"q":"weather"}' },
              },
            ],
          },
        },
      ],
    };
    const parsed = parseOpenAIResponse(raw);
    expect(parsed.type).toBe('tool_calls');
    if (parsed.type === 'tool_calls') {
      expect(parsed.reasoning).toBeUndefined();
      expect(parsed.content).toBe('I will now run the search.');
    }
  });

  it('should parse tool call with empty arguments into ValidToolCallRequest with empty object', () => {
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

  it('should parse malformed JSON arguments into MalformedToolCallRequest without throwing', () => {
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

  it('should treat non-object JSON tool arguments as MalformedToolCallRequest', () => {
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
