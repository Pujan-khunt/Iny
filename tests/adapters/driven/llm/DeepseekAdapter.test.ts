import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeepseekAdapter } from '../../../../src/adapters/driven/llm/DeepseekAdapter';
import OpenAI from 'openai';
import { Plugin } from '../../../../src/core/ports/PluginRegistryPort';
import { Message } from '../../../../src/core/entities/Message';
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
    })
  };
});

describe('DeepseekAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize OpenAI client with apiKey and deepseek baseURL', () => {
    new DeepseekAdapter('test_api_key');
    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: 'test_api_key',
      baseURL: 'https://api.deepseek.com',
    });
  });

  it('should generate text response when no tool calls are returned', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Mock response' } }]
    });

    const adapter = new DeepseekAdapter('fake_key');
    const response = await adapter.generateResponse(
      'System prompt',
      [],
      { id: '1', userId: 'u1', content: 'Hello', timestamp: new Date() },
      []
    );

    expect(response.text).toBe('Mock response');
    expect(response.toolCall).toBeUndefined();
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

  it('should handle history and new message mapped correctly to user messages', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Response with history' } }]
    });

    const adapter = new DeepseekAdapter('fake_key');
    const history: Message[] = [
      { id: '1', userId: 'u1', content: 'Previous msg 1', timestamp: new Date() },
      { id: '2', userId: 'u1', content: 'Previous msg 2', timestamp: new Date() },
    ];
    const newMessage: Message = { id: '3', userId: 'u1', content: 'Latest msg', timestamp: new Date() };

    await adapter.generateResponse('System prompt', history, newMessage, []);

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Previous msg 1' },
        { role: 'user', content: 'Previous msg 2' },
        { role: 'user', content: 'Latest msg' },
      ]
    }));
  });

  it('should return toolCall when model returns tool_calls', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: JSON.stringify({ location: 'London' })
              }
            }
          ]
        }
      }]
    });

    const plugins: Plugin[] = [
      {
        name: 'get_weather',
        description: 'Get current weather',
        schema: { type: 'object', properties: { location: { type: 'string' } } },
        execute: vi.fn(),
      }
    ];

    const adapter = new DeepseekAdapter('fake_key');
    const response = await adapter.generateResponse(
      'System prompt',
      [],
      { id: '1', userId: 'u1', content: 'What is the weather?', timestamp: new Date() },
      plugins
    );

    expect(response.toolCall).toEqual({
      name: 'get_weather',
      arguments: { location: 'London' }
    });
    expect(response.text).toBeUndefined();

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get current weather',
            parameters: { type: 'object', properties: { location: { type: 'string' } } }
          }
        }
      ],
      tool_choice: 'auto'
    }));
  });

  it('should return empty string for text if response message content is null or undefined', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: null } }]
    });

    const adapter = new DeepseekAdapter('fake_key');
    const response = await adapter.generateResponse(
      'System prompt',
      [],
      { id: '1', userId: 'u1', content: 'Hello', timestamp: new Date() },
      []
    );

    expect(response.text).toBe('');
    expect(response.toolCall).toBeUndefined();
  });

  it('should throw LLMResponseError when choices array is empty', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [] });

    const adapter = new DeepseekAdapter('fake_key');
    await expect(
      adapter.generateResponse(
        'System prompt',
        [],
        { id: '1', userId: 'u1', content: 'Hello', timestamp: new Date() },
        []
      )
    ).rejects.toThrow(LLMResponseError);
  });

  it('should throw LLMResponseError when choices field is missing or undefined', async () => {
    mockCreate.mockResolvedValueOnce({} as any);

    const adapter = new DeepseekAdapter('fake_key');
    await expect(
      adapter.generateResponse(
        'System prompt',
        [],
        { id: '1', userId: 'u1', content: 'Hello', timestamp: new Date() },
        []
      )
    ).rejects.toThrow(LLMResponseError);
  });

  it('should throw LLMResponseError when choice exists but message is missing', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: undefined }] as any });

    const adapter = new DeepseekAdapter('fake_key');
    await expect(
      adapter.generateResponse(
        'System prompt',
        [],
        { id: '1', userId: 'u1', content: 'Hello', timestamp: new Date() },
        []
      )
    ).rejects.toThrow(LLMResponseError);
  });

  it('should throw LLMAuthenticationError when API returns 401', async () => {
    const error = Object.assign(new Error('Authentication failed due to wrong API key'), { status: 401 });
    mockCreate.mockRejectedValueOnce(error);

    const adapter = new DeepseekAdapter('fake_key');
    await expect(
      adapter.generateResponse(
        'System prompt',
        [],
        { id: '1', userId: 'u1', content: 'Hello', timestamp: new Date() },
        []
      )
    ).rejects.toThrow(LLMAuthenticationError);
  });

  it('should throw LLMInsufficientBalanceError when API returns 402', async () => {
    const error = Object.assign(new Error('Insufficient Balance'), { status: 402 });
    mockCreate.mockRejectedValueOnce(error);

    const adapter = new DeepseekAdapter('fake_key');
    await expect(
      adapter.generateResponse(
        'System prompt',
        [],
        { id: '1', userId: 'u1', content: 'Hello', timestamp: new Date() },
        []
      )
    ).rejects.toThrow(LLMInsufficientBalanceError);
  });

  it('should throw LLMInvalidRequestError when API returns 400 or 422', async () => {
    const error400 = Object.assign(new Error('Invalid Format'), { status: 400 });
    mockCreate.mockRejectedValueOnce(error400);

    const adapter = new DeepseekAdapter('fake_key');
    await expect(
      adapter.generateResponse(
        'System prompt',
        [],
        { id: '1', userId: 'u1', content: 'Hello', timestamp: new Date() },
        []
      )
    ).rejects.toThrow(LLMInvalidRequestError);

    const error422 = Object.assign(new Error('Invalid Parameters'), { status: 422 });
    mockCreate.mockRejectedValueOnce(error422);

    await expect(
      adapter.generateResponse(
        'System prompt',
        [],
        { id: '1', userId: 'u1', content: 'Hello', timestamp: new Date() },
        []
      )
    ).rejects.toThrow(LLMInvalidRequestError);
  });

  it('should throw LLMRateLimitError when API returns 429', async () => {
    const error = Object.assign(new Error('Rate Limit Reached'), { status: 429 });
    mockCreate.mockRejectedValueOnce(error);

    const adapter = new DeepseekAdapter('fake_key');
    await expect(
      adapter.generateResponse(
        'System prompt',
        [],
        { id: '1', userId: 'u1', content: 'Hello', timestamp: new Date() },
        []
      )
    ).rejects.toThrow(LLMRateLimitError);
  });

  it('should throw LLMServerError when API returns 500', async () => {
    const error = Object.assign(new Error('Server Error'), { status: 500 });
    mockCreate.mockRejectedValueOnce(error);

    const adapter = new DeepseekAdapter('fake_key');
    await expect(
      adapter.generateResponse(
        'System prompt',
        [],
        { id: '1', userId: 'u1', content: 'Hello', timestamp: new Date() },
        []
      )
    ).rejects.toThrow(LLMServerError);
  });

  it('should throw LLMServerOverloadedError when API returns 503', async () => {
    const error = Object.assign(new Error('Server Overloaded'), { status: 503 });
    mockCreate.mockRejectedValueOnce(error);

    const adapter = new DeepseekAdapter('fake_key');
    await expect(
      adapter.generateResponse(
        'System prompt',
        [],
        { id: '1', userId: 'u1', content: 'Hello', timestamp: new Date() },
        []
      )
    ).rejects.toThrow(LLMServerOverloadedError);
  });

  it('should throw generic LLMError when API returns unexpected status or network error', async () => {
    const networkError = new Error('Network connection failed');
    mockCreate.mockRejectedValueOnce(networkError);

    const adapter = new DeepseekAdapter('fake_key');
    await expect(
      adapter.generateResponse(
        'System prompt',
        [],
        { id: '1', userId: 'u1', content: 'Hello', timestamp: new Date() },
        []
      )
    ).rejects.toThrow(LLMError);
  });
});
