import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeepseekAdapter } from '../../../../src/adapters/outbound/llm/DeepseekAdapter';
import { LLMAuthenticationError } from '../../../../src/core/errors/LLMErrors';
import { ToolDefinition } from '../../../../src/core/ports/ToolRegistryPort';

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function (this: any, config: any) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.chat = { completions: { create: mockCreate } };
    return this;
  }),
}));

describe('DeepseekAdapter Coordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should coordinate mapper, SDK, and parser for text response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ finish_reason: 'stop', message: { content: 'Mock answer' } }],
    });

    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(),
    };

    const adapter = new DeepseekAdapter('test-key', {
      model: 'custom-model',
      logger: mockLogger,
    });
    const response = await adapter.generateResponse('System prompt', [], []);

    expect(response).toEqual({
      type: 'text',
      content: 'Mock answer',
      thought: undefined,
    });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'custom-model',
        messages: [{ role: 'system', content: 'System prompt' }],
        tools: undefined,
        tool_choice: undefined,
      })
    );
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Sending request to Deepseek LLM',
      expect.objectContaining({ model: 'custom-model' })
    );
  });

  it('should pass tool definitions to client completions', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'calc', arguments: '{"expr":"1+1"}' } },
            ],
          },
        },
      ],
    });

    const adapter = new DeepseekAdapter('test-key');
    const tools: ToolDefinition[] = [
      { name: 'calc', description: 'calculate', schema: { type: 'object' } },
    ];
    const response = await adapter.generateResponse('System', [], tools);

    expect(response.type).toBe('tool_calls');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          {
            type: 'function',
            function: { name: 'calc', description: 'calculate', parameters: { type: 'object' } },
          },
        ],
        tool_choice: 'auto',
      })
    );
  });

  it('should translate and throw error on client failure', async () => {
    mockCreate.mockRejectedValueOnce({ status: 401, message: 'Invalid API Key' });

    const adapter = new DeepseekAdapter('bad-key');
    await expect(adapter.generateResponse('System', [], [])).rejects.toThrow(LLMAuthenticationError);
  });

  it('should accept custom baseURL and model in options', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ finish_reason: 'stop', message: { content: 'Custom ok' } }],
    });

    const adapter = new DeepseekAdapter('custom-key', {
      baseURL: 'https://custom.deepseek.com',
      model: 'custom-model',
    });

    const response = await adapter.generateResponse('System', [], []);
    expect(response).toEqual({
      type: 'text',
      content: 'Custom ok',
      thought: undefined,
    });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'custom-model',
      })
    );
  });
});
