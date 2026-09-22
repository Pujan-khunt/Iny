import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeepseekAdapter } from '../../../../src/adapters/outbound/llm/DeepseekAdapter';
import OpenAI from 'openai';
import { Plugin } from '../../../../src/core/ports/PluginRegistryPort';
import {
  Message,
  UserMessage,
  AssistantMessage,
  ToolMessage,
} from '../../../../src/core/entities/Message';
import { LoggerPort } from '../../../../src/core/ports/LoggerPort';
import {
  LLMError,
  LLMAuthenticationError,
  LLMInsufficientBalanceError,
  LLMInvalidRequestError,
  LLMRateLimitError,
  LLMServerError,
  LLMServerOverloadedError,
  LLMResponseError,
} from '../../../../src/core/errors/LLMErrors';

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(function (this: any, config: any) {
      this.chat = { completions: { create: mockCreate } };
      this.apiKey = config?.apiKey;
      this.baseURL = config?.baseURL;
      return this;
    }),
  };
});

describe('DeepseekAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMockLogger = (): LoggerPort => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  });

  const defaultUserMessage: UserMessage = {
    id: '1',
    userId: 'u1',
    role: 'user',
    content: 'Hello',
    timestamp: new Date(),
  };

  it('should initialize OpenAI client with apiKey and deepseek baseURL', () => {
    new DeepseekAdapter('test_api_key');
    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: 'test_api_key',
      baseURL: 'https://api.deepseek.com',
    });
  });

  it('should initialize OpenAI client with custom baseURL and use custom model', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ finish_reason: 'stop', message: { content: 'Custom model response' } }],
    });

    const adapter = new DeepseekAdapter('test_api_key', {
      baseURL: 'https://custom.endpoint.com/v1',
      model: 'deepseek-chat',
    });

    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: 'test_api_key',
      baseURL: 'https://custom.endpoint.com/v1',
    });

    await adapter.generateResponse('System prompt', [defaultUserMessage], []);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'deepseek-chat',
      })
    );
  });

  it('should accept logger and options in 3-argument constructor', () => {
    const mockLogger = createMockLogger();
    new DeepseekAdapter('test_api_key', mockLogger, {
      baseURL: 'https://proxy.example.com',
      model: 'custom-model',
    });

    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: 'test_api_key',
      baseURL: 'https://proxy.example.com',
    });
  });

  it('should map assistant message defensively to empty string if content is missing and no tool calls exist', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ finish_reason: 'stop', message: { content: 'OK' } }],
    });

    const adapter = new DeepseekAdapter('fake_key');
    const historyWithEmptyAssistant: Message[] = [
      defaultUserMessage,
      {
        id: 'bad-assistant',
        userId: 'u1',
        role: 'assistant',
      } as any,
    ];

    await adapter.generateResponse('System prompt', historyWithEmptyAssistant, []);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          {
            role: 'assistant',
            content: '',
          },
        ]),
      })
    );
  });

  it('should normalize whitespace-only assistant content to null when toolCalls are present', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ finish_reason: 'stop', message: { content: 'OK' } }],
    });

    const adapter = new DeepseekAdapter('fake_key');
    const historyWithWhitespaceToolAssistant: Message[] = [
      defaultUserMessage,
      {
        id: 'whitespace-assistant',
        userId: 'u1',
        role: 'assistant',
        content: '   ',
        toolCalls: [{ id: 'call_1', name: 'calc', arguments: {} }],
        timestamp: new Date(),
      },
    ];

    await adapter.generateResponse('System prompt', historyWithWhitespaceToolAssistant, []);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          {
            role: 'assistant',
            content: null,
            tool_calls: expect.any(Array),
          },
        ]),
      })
    );
  });

  it('should map thought to reasoning_content on assistant message when replaying history', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ finish_reason: 'stop', message: { content: 'OK' } }],
    });

    const adapter = new DeepseekAdapter('fake_key');
    const historyWithThought: Message[] = [
      defaultUserMessage,
      {
        id: 'assistant-with-thought',
        userId: 'u1',
        role: 'assistant',
        thought: 'I need to calculate the sum first',
        toolCalls: [{ id: 'call_1', name: 'calc', arguments: { a: 1, b: 2 } }],
        timestamp: new Date(),
      },
    ];

    await adapter.generateResponse('System prompt', historyWithThought, []);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'assistant',
            reasoning_content: 'I need to calculate the sum first',
            tool_calls: expect.any(Array),
          }),
        ]),
      })
    );
  });

  it('should generate text response when no tool calls are returned', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ finish_reason: 'stop', message: { content: 'Mock response' } }],
    });

    const adapter = new DeepseekAdapter('fake_key');
    const response = await adapter.generateResponse('System prompt', [defaultUserMessage], []);

    expect(response).toEqual({
      type: 'text',
      content: 'Mock response',
      thought: undefined,
    });
    expect(mockCreate).toHaveBeenCalledWith({
      model: 'deepseek-flash',
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Hello' },
      ],
      tools: undefined,
      tool_choice: undefined,
    });
  });

  it('should map heterogeneous history (user, assistant with tool calls, tool, assistant text) to OpenAI messages', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ finish_reason: 'stop', message: { content: 'Final response' } }],
    });

    const adapter = new DeepseekAdapter('fake_key');
    const history: Message[] = [
      {
        id: '1',
        userId: 'u1',
        role: 'user',
        content: 'Calculate 2+2 and tell me weather in Paris',
        timestamp: new Date(),
      },
      {
        id: '2',
        userId: 'u1',
        role: 'assistant',
        thought: 'I need to use calculator and weather plugins',
        toolCalls: [
          { id: 'call_1', name: 'calculate', arguments: { expression: '2+2' } },
          { id: 'call_2', name: 'get_weather', arguments: { city: 'Paris' } },
        ],
        timestamp: new Date(),
      },
      {
        id: '3',
        userId: 'u1',
        role: 'tool',
        toolCallId: 'call_1',
        name: 'calculate',
        content: '4',
        timestamp: new Date(),
      },
      {
        id: '4',
        userId: 'u1',
        role: 'tool',
        toolCallId: 'call_2',
        name: 'get_weather',
        content: 'Sunny, 20°C',
        timestamp: new Date(),
      },
      {
        id: '5',
        userId: 'u1',
        role: 'assistant',
        content: '2+2 is 4 and Paris is sunny at 20°C.',
        timestamp: new Date(),
      },
      {
        id: '6',
        userId: 'u1',
        role: 'user',
        content: 'Thank you!',
        timestamp: new Date(),
      },
    ];

    await adapter.generateResponse('System prompt', history, []);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'system', content: 'System prompt' },
          { role: 'user', content: 'Calculate 2+2 and tell me weather in Paris' },
          {
            role: 'assistant',
            content: null,
            reasoning_content: 'I need to use calculator and weather plugins',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'calculate', arguments: JSON.stringify({ expression: '2+2' }) },
              },
              {
                id: 'call_2',
                type: 'function',
                function: { name: 'get_weather', arguments: JSON.stringify({ city: 'Paris' }) },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'call_1', content: '4' },
          { role: 'tool', tool_call_id: 'call_2', content: 'Sunny, 20°C' },
          { role: 'assistant', content: '2+2 is 4 and Paris is sunny at 20°C.' },
          { role: 'user', content: 'Thank you!' },
        ],
      })
    );
  });

  it('should return tool_calls decision when model returns finish_reason === tool_calls with parallel tool calls', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: JSON.stringify({ location: 'London' }),
                },
              },
              {
                id: 'call_2',
                type: 'function',
                function: {
                  name: 'calculate',
                  arguments: JSON.stringify({ expression: '10*5' }),
                },
              },
            ],
          },
        },
      ],
    });

    const plugins: Plugin[] = [
      {
        name: 'get_weather',
        description: 'Get current weather',
        schema: { type: 'object', properties: { location: { type: 'string' } } },
        execute: vi.fn(),
      },
      {
        name: 'calculate',
        description: 'Perform calculation',
        schema: { type: 'object', properties: { expression: { type: 'string' } } },
        execute: vi.fn(),
      },
    ];

    const adapter = new DeepseekAdapter('fake_key');
    const response = await adapter.generateResponse(
      'System prompt',
      [
        {
          id: '1',
          userId: 'u1',
          role: 'user',
          content: 'What is the weather and 10*5?',
          timestamp: new Date(),
        },
      ],
      plugins
    );

    expect(response).toEqual({
      type: 'tool_calls',
      toolCalls: [
        {
          id: 'call_1',
          name: 'get_weather',
          arguments: { location: 'London' },
        },
        {
          id: 'call_2',
          name: 'calculate',
          arguments: { expression: '10*5' },
        },
      ],
      thought: undefined,
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get current weather',
              parameters: { type: 'object', properties: { location: { type: 'string' } } },
            },
          },
          {
            type: 'function',
            function: {
              name: 'calculate',
              description: 'Perform calculation',
              parameters: { type: 'object', properties: { expression: { type: 'string' } } },
            },
          },
        ],
        tool_choice: 'auto',
      })
    );
  });

  it('should fall back to text response if tool_calls contains no function calls', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: 'No function tool call here',
            tool_calls: [
              {
                id: 'call_custom',
                type: 'custom_type' as any,
                function: { name: 'unknown', arguments: '{}' },
              },
            ],
            reasoning_content: 'Thought process',
          },
        },
      ],
    });

    const adapter = new DeepseekAdapter('fake_key');
    const response = await adapter.generateResponse('System prompt', [defaultUserMessage], []);

    expect(response).toEqual({
      type: 'text',
      content: 'No function tool call here',
      thought: 'Thought process',
    });
  });

  it('should fall back to text response if tool_calls is an empty array', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: 'Empty tool calls array',
            tool_calls: [],
          },
        },
      ],
    });

    const adapter = new DeepseekAdapter('fake_key');
    const response = await adapter.generateResponse('System prompt', [defaultUserMessage], []);

    expect(response).toEqual({
      type: 'text',
      content: 'Empty tool calls array',
      thought: undefined,
    });
  });

  it('should extract thought from reasoning_content (DeepSeek V4.1 Flash) on text response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: 'The answer is 42',
            reasoning_content: 'User asked about meaning of life. Deep thought needed.',
          },
        },
      ],
    });

    const adapter = new DeepseekAdapter('fake_key');
    const response = await adapter.generateResponse('System prompt', [defaultUserMessage], []);

    expect(response).toEqual({
      type: 'text',
      content: 'The answer is 42',
      thought: 'User asked about meaning of life. Deep thought needed.',
    });
  });

  it('should extract thought from reasoning_content on tool calls response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            reasoning_content: 'Must look up current weather for Paris.',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: JSON.stringify({ location: 'Paris' }),
                },
              },
            ],
          },
        },
      ],
    });

    const adapter = new DeepseekAdapter('fake_key');
    const response = await adapter.generateResponse('System prompt', [defaultUserMessage], []);

    expect(response).toEqual({
      type: 'tool_calls',
      toolCalls: [
        {
          id: 'call_1',
          name: 'get_weather',
          arguments: { location: 'Paris' },
        },
      ],
      thought: 'Must look up current weather for Paris.',
    });
  });

  it('should fallback to intermediate content for thought when reasoning_content is absent during tool calling', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: 'I will check the weather for you first.',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: JSON.stringify({ location: 'Tokyo' }),
                },
              },
            ],
          },
        },
      ],
    });

    const adapter = new DeepseekAdapter('fake_key');
    const response = await adapter.generateResponse('System prompt', [defaultUserMessage], []);

    expect(response).toEqual({
      type: 'tool_calls',
      toolCalls: [
        {
          id: 'call_1',
          name: 'get_weather',
          arguments: { location: 'Tokyo' },
        },
      ],
      thought: 'I will check the weather for you first.',
    });
  });

  it('should omit tools parameter when forcedSynthesis is true', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: 'Here is the synthesized final response after circuit breaker.',
          },
        },
      ],
    });

    const plugins: Plugin[] = [
      {
        name: 'get_weather',
        description: 'Get weather',
        schema: {},
        execute: vi.fn(),
      },
    ];

    const adapter = new DeepseekAdapter('fake_key');
    const response = await adapter.generateResponse(
      'System prompt',
      [defaultUserMessage],
      plugins,
      { forcedSynthesis: true }
    );

    expect(response).toEqual({
      type: 'text',
      content: 'Here is the synthesized final response after circuit breaker.',
      thought: undefined,
    });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: undefined,
        tool_choice: undefined,
      })
    );
  });

  it('should parse arguments defensively and default to empty object when JSON is malformed', async () => {
    const mockLogger = createMockLogger();

    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'calculate',
                  arguments: '{"invalid_json: true',
                },
              },
            ],
          },
        },
      ],
    });

    const adapter = new DeepseekAdapter('test-key', mockLogger);
    const response = await adapter.generateResponse('system', [defaultUserMessage], []);

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to parse tool arguments',
      expect.any(Error)
    );
    expect(response).toEqual({
      type: 'tool_calls',
      toolCalls: [
        {
          id: 'call_1',
          name: 'calculate',
          arguments: {
            _parseError: expect.stringContaining('Malformed JSON arguments'),
          },
        },
      ],
      thought: undefined,
    });
  });

  it('should default to empty object when tool arguments are empty string or whitespace', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            tool_calls: [
              {
                id: 'call_empty',
                type: 'function',
                function: {
                  name: 'get_time',
                  arguments: '   ',
                },
              },
            ],
          },
        },
      ],
    });

    const adapter = new DeepseekAdapter('test-key');
    const response = await adapter.generateResponse('system', [defaultUserMessage], []);

    expect(response).toEqual({
      type: 'tool_calls',
      toolCalls: [
        {
          id: 'call_empty',
          name: 'get_time',
          arguments: {},
        },
      ],
      thought: undefined,
    });
  });

  it('should parse arguments defensively and include _parseError when tool arguments parse to non-object JSON values', async () => {
    const mockLogger = createMockLogger();

    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'calculate',
                  arguments: 'null',
                },
              },
              {
                id: 'call_2',
                type: 'function',
                function: {
                  name: 'calculate',
                  arguments: '123',
                },
              },
            ],
          },
        },
      ],
    });

    const adapter = new DeepseekAdapter('test-key', mockLogger);
    const response = await adapter.generateResponse('system', [defaultUserMessage], []);

    expect(mockLogger.error).toHaveBeenCalledTimes(2);
    expect(response).toEqual({
      type: 'tool_calls',
      toolCalls: [
        {
          id: 'call_1',
          name: 'calculate',
          arguments: {
            _parseError: expect.stringContaining('Malformed JSON arguments'),
          },
        },
        {
          id: 'call_2',
          name: 'calculate',
          arguments: {
            _parseError: expect.stringContaining('Malformed JSON arguments'),
          },
        },
      ],
      thought: undefined,
    });
  });

  it('should return empty string for text if response message content is null or undefined', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: null } }],
    });

    const adapter = new DeepseekAdapter('fake_key');
    const response = await adapter.generateResponse('System prompt', [defaultUserMessage], []);

    expect(response).toEqual({
      type: 'text',
      content: '',
      thought: undefined,
    });
  });

  it('should throw LLMResponseError when choices array is empty', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [] });

    const adapter = new DeepseekAdapter('fake_key');
    await expect(
      adapter.generateResponse('System prompt', [defaultUserMessage], [])
    ).rejects.toThrow(LLMResponseError);
  });

  it('should throw LLMResponseError when choices field is missing or undefined', async () => {
    mockCreate.mockResolvedValueOnce({} as any);

    const adapter = new DeepseekAdapter('fake_key');
    await expect(
      adapter.generateResponse('System prompt', [defaultUserMessage], [])
    ).rejects.toThrow(LLMResponseError);
  });

  it('should throw LLMResponseError when choice exists but message is missing', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: undefined }] as any });

    const adapter = new DeepseekAdapter('fake_key');
    await expect(
      adapter.generateResponse('System prompt', [defaultUserMessage], [])
    ).rejects.toThrow(LLMResponseError);
  });

  it('should throw LLMAuthenticationError when API returns 401', async () => {
    const error = Object.assign(new Error('Authentication failed due to wrong API key'), {
      status: 401,
    });
    mockCreate.mockRejectedValueOnce(error);

    const adapter = new DeepseekAdapter('fake_key');
    await expect(
      adapter.generateResponse('System prompt', [defaultUserMessage], [])
    ).rejects.toThrow(LLMAuthenticationError);
  });

  it('should throw LLMInsufficientBalanceError when API returns 402', async () => {
    const error = Object.assign(new Error('Insufficient Balance'), { status: 402 });
    mockCreate.mockRejectedValueOnce(error);

    const adapter = new DeepseekAdapter('fake_key');
    await expect(
      adapter.generateResponse('System prompt', [defaultUserMessage], [])
    ).rejects.toThrow(LLMInsufficientBalanceError);
  });

  it('should throw LLMInvalidRequestError when API returns 400 or 422', async () => {
    const error400 = Object.assign(new Error('Invalid Format'), { status: 400 });
    mockCreate.mockRejectedValueOnce(error400);

    const adapter = new DeepseekAdapter('fake_key');
    await expect(
      adapter.generateResponse('System prompt', [defaultUserMessage], [])
    ).rejects.toThrow(LLMInvalidRequestError);

    const error422 = Object.assign(new Error('Invalid Parameters'), { status: 422 });
    mockCreate.mockRejectedValueOnce(error422);

    await expect(
      adapter.generateResponse('System prompt', [defaultUserMessage], [])
    ).rejects.toThrow(LLMInvalidRequestError);
  });

  it('should throw LLMRateLimitError when API returns 429', async () => {
    const error = Object.assign(new Error('Rate Limit Reached'), { status: 429 });
    mockCreate.mockRejectedValueOnce(error);

    const adapter = new DeepseekAdapter('fake_key');
    await expect(
      adapter.generateResponse('System prompt', [defaultUserMessage], [])
    ).rejects.toThrow(LLMRateLimitError);
  });

  it('should throw LLMServerError when API returns 500', async () => {
    const error = Object.assign(new Error('Server Error'), { status: 500 });
    mockCreate.mockRejectedValueOnce(error);

    const adapter = new DeepseekAdapter('fake_key');
    await expect(
      adapter.generateResponse('System prompt', [defaultUserMessage], [])
    ).rejects.toThrow(LLMServerError);
  });

  it('should throw LLMServerOverloadedError when API returns 503', async () => {
    const error = Object.assign(new Error('Server Overloaded'), { status: 503 });
    mockCreate.mockRejectedValueOnce(error);

    const adapter = new DeepseekAdapter('fake_key');
    await expect(
      adapter.generateResponse('System prompt', [defaultUserMessage], [])
    ).rejects.toThrow(LLMServerOverloadedError);
  });

  it('should throw generic LLMError when API returns unexpected status or network error', async () => {
    const networkError = new Error('Network connection failed');
    mockCreate.mockRejectedValueOnce(networkError);

    const adapter = new DeepseekAdapter('fake_key');
    await expect(
      adapter.generateResponse('System prompt', [defaultUserMessage], [])
    ).rejects.toThrow(LLMError);
  });

  it('should log debug info when optional logger is provided', async () => {
    const mockLogger = createMockLogger();
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Logged response' } }],
    });

    const adapter = new DeepseekAdapter('test-key', mockLogger);

    await adapter.generateResponse('system', [defaultUserMessage], []);

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Sending request to Deepseek LLM',
      expect.objectContaining({ model: 'deepseek-flash' })
    );
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Received response from Deepseek LLM',
      expect.objectContaining({ hasToolCall: false })
    );
  });
});
