import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop, AgentLoopConfig } from '../../../src/core/use-cases/AgentLoop';
import { LLMPort } from '../../../src/core/ports/LLMPort';
import { ToolRegistryPort, ToolDefinition } from '../../../src/core/ports/ToolRegistryPort';
import { LoggerPort } from '../../../src/core/ports/LoggerPort';
import { UserMessage } from '../../../src/core/entities/Message';
import { ValidToolCall, MalformedToolCall } from '../../../src/core/entities/ToolCall';

describe('AgentLoop', () => {
  let mockLLM: LLMPort;
  let mockRegistry: ToolRegistryPort;
  let mockLogger: LoggerPort;

  const defaultSystemPrompt = 'You are a helpful assistant.';
  const defaultTools: ToolDefinition[] = [
    {
      name: 'calculator',
      description: 'Calculates mathematical expressions',
      schema: { type: 'object' },
    },
  ];

  const createMockLogger = (): LoggerPort => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  });

  const createAgentLoop = (configOverrides?: Partial<AgentLoopConfig>): AgentLoop => {
    return new AgentLoop(mockLLM, mockRegistry, {
      systemPrompt: defaultSystemPrompt,
      ...configOverrides,
    });
  };

  const sampleUserMessage: UserMessage = {
    id: 'user-msg-1',
    userId: 'user-123',
    role: 'user',
    content: 'Calculate 2+2',
    timestamp: new Date('2026-09-23T12:00:00Z'),
  };

  beforeEach(() => {
    mockLLM = {
      generateResponse: vi.fn(),
    };
    mockRegistry = {
      getToolDefinitions: vi.fn().mockReturnValue(defaultTools),
      executeTool: vi.fn(),
    };
    mockLogger = createMockLogger();
  });

  it('should immediately return final text response when LLM responds with text', async () => {
    vi.mocked(mockLLM.generateResponse).mockResolvedValueOnce({
      type: 'text',
      content: 'The answer is 4.',
      thought: 'Simple math question.',
    });

    const loop = createAgentLoop();
    const result = await loop.run(sampleUserMessage, [], defaultTools, mockLogger);

    expect(result.finalText).toBe('The answer is 4.');
    expect(result.thought).toBe('Simple math question.');
    expect(result.sessionMessages).toHaveLength(2);
    expect(result.sessionMessages[0]).toEqual(sampleUserMessage);
    expect(result.sessionMessages[1]).toMatchObject({
      role: 'assistant',
      content: 'The answer is 4.',
      thought: 'Simple math question.',
      userId: 'user-123',
    });
    expect(mockRegistry.executeTool).not.toHaveBeenCalled();
  });

  it('should use fallback message when text response is empty or whitespace', async () => {
    vi.mocked(mockLLM.generateResponse).mockResolvedValueOnce({
      type: 'text',
      content: '   ',
    });

    const loop = createAgentLoop();
    const result = await loop.run(sampleUserMessage, [], defaultTools, mockLogger);

    expect(result.finalText).toBe('I apologize, but I was unable to formulate a response.');
    expect(result.sessionMessages[1]).toMatchObject({
      role: 'assistant',
      content: 'I apologize, but I was unable to formulate a response.',
    });
  });

  it('should execute tool and feed result back to LLM before delivering final response', async () => {
    const validCall: ValidToolCall = {
      type: 'valid',
      id: 'call-1',
      name: 'calculator',
      arguments: { expr: '2+2' },
    };

    vi.mocked(mockLLM.generateResponse)
      .mockResolvedValueOnce({
        type: 'tool_calls',
        toolCalls: [validCall],
        thought: 'Let me calculate that.',
      })
      .mockResolvedValueOnce({
        type: 'text',
        content: 'Result is 4.',
      });

    vi.mocked(mockRegistry.executeTool).mockResolvedValueOnce('4');

    const loop = createAgentLoop();
    const result = await loop.run(sampleUserMessage, [], defaultTools, mockLogger);

    expect(mockRegistry.executeTool).toHaveBeenCalledWith('calculator', { expr: '2+2' });
    expect(mockLLM.generateResponse).toHaveBeenCalledTimes(2);

    expect(result.finalText).toBe('Result is 4.');
    expect(result.sessionMessages).toHaveLength(4);

    // Turn structure verification
    expect(result.sessionMessages[0]).toEqual(sampleUserMessage);
    expect(result.sessionMessages[1]).toMatchObject({
      role: 'assistant',
      thought: 'Let me calculate that.',
      toolCalls: [validCall],
    });
    expect(result.sessionMessages[2]).toMatchObject({
      role: 'tool',
      toolCallId: 'call-1',
      name: 'calculator',
      content: '4',
    });
    expect(result.sessionMessages[3]).toMatchObject({
      role: 'assistant',
      content: 'Result is 4.',
    });
  });

  it('should execute multiple tool calls concurrently via Promise.all', async () => {
    const call1: ValidToolCall = {
      type: 'valid',
      id: 'call-1',
      name: 'calculator',
      arguments: { expr: '1+1' },
    };
    const call2: ValidToolCall = {
      type: 'valid',
      id: 'call-2',
      name: 'calculator',
      arguments: { expr: '2+2' },
    };

    const callOrder: string[] = [];
    vi.mocked(mockRegistry.executeTool).mockImplementation(async (_name, args) => {
      callOrder.push(`start:${args.expr}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      callOrder.push(`end:${args.expr}`);
      return `result:${args.expr}`;
    });

    vi.mocked(mockLLM.generateResponse)
      .mockResolvedValueOnce({
        type: 'tool_calls',
        toolCalls: [call1, call2],
      })
      .mockResolvedValueOnce({
        type: 'text',
        content: 'Both calculations complete.',
      });

    const loop = createAgentLoop();
    await loop.run(sampleUserMessage, [], defaultTools, mockLogger);

    expect(callOrder[0]).toBe('start:1+1');
    expect(callOrder[1]).toBe('start:2+2');
    expect(mockLLM.generateResponse).toHaveBeenCalledTimes(2);

    const secondCallMessages = vi.mocked(mockLLM.generateResponse).mock.calls[1][1];
    expect(secondCallMessages).toHaveLength(4);
    expect(secondCallMessages[2]).toMatchObject({
      role: 'tool',
      toolCallId: 'call-1',
      content: 'result:1+1',
    });
    expect(secondCallMessages[3]).toMatchObject({
      role: 'tool',
      toolCallId: 'call-2',
      content: 'result:2+2',
    });
  });

  it('should handle malformed tool calls without calling tool registry', async () => {
    const malformedCall: MalformedToolCall = {
      type: 'malformed',
      id: 'call-malformed',
      name: 'calculator',
      rawArguments: '{"expr": 2+',
      parseError: 'Unexpected end of JSON',
    };

    vi.mocked(mockLLM.generateResponse)
      .mockResolvedValueOnce({
        type: 'tool_calls',
        toolCalls: [malformedCall],
      })
      .mockResolvedValueOnce({
        type: 'text',
        content: 'I had a syntax error in tool parameters.',
      });

    const loop = createAgentLoop();
    const result = await loop.run(sampleUserMessage, [], defaultTools, mockLogger);

    expect(mockRegistry.executeTool).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Tool call arguments were malformed',
      undefined,
      {
        toolName: 'calculator',
        parseError: 'Unexpected end of JSON',
      }
    );

    expect(result.sessionMessages[2]).toMatchObject({
      role: 'tool',
      toolCallId: 'call-malformed',
      name: 'calculator',
      content: "Error executing tool 'calculator': Failed to parse tool arguments: Unexpected end of JSON",
    });
    expect(result.finalText).toBe('I had a syntax error in tool parameters.');
  });

  it('should catch tool execution errors, log warning, and feed error message to model', async () => {
    const validCall: ValidToolCall = {
      type: 'valid',
      id: 'call-error',
      name: 'calculator',
      arguments: { expr: '1/0' },
    };

    const toolError = new Error('Division by zero error');
    vi.mocked(mockRegistry.executeTool).mockRejectedValueOnce(toolError);

    vi.mocked(mockLLM.generateResponse)
      .mockResolvedValueOnce({
        type: 'tool_calls',
        toolCalls: [validCall],
      })
      .mockResolvedValueOnce({
        type: 'text',
        content: 'Division by zero is undefined.',
      });

    const loop = createAgentLoop();
    const result = await loop.run(sampleUserMessage, [], defaultTools, mockLogger);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Tool execution failed',
      toolError,
      { toolName: 'calculator' }
    );
    expect(result.sessionMessages[2]).toMatchObject({
      role: 'tool',
      toolCallId: 'call-error',
      name: 'calculator',
      content: "Error executing tool 'calculator': Division by zero error",
    });
    expect(result.finalText).toBe('Division by zero is undefined.');
  });

  it('should trigger circuit breaker when max iterations is reached with forcedSynthesis', async () => {
    const loopCall: ValidToolCall = {
      type: 'valid',
      id: 'call-loop',
      name: 'calculator',
      arguments: {},
    };

    vi.mocked(mockRegistry.executeTool).mockResolvedValue('ok');

    vi.mocked(mockLLM.generateResponse)
      .mockResolvedValueOnce({
        type: 'tool_calls',
        toolCalls: [loopCall],
      })
      .mockResolvedValueOnce({
        type: 'tool_calls',
        toolCalls: [loopCall],
      })
      .mockResolvedValueOnce({
        type: 'text',
        content: 'Forced synthesis final answer.',
        thought: 'Max iterations reached.',
      });

    const loop = createAgentLoop({ maxToolIterations: 2 });
    const result = await loop.run(sampleUserMessage, [], defaultTools, mockLogger);

    expect(mockLLM.generateResponse).toHaveBeenCalledTimes(3);
    expect(vi.mocked(mockLLM.generateResponse).mock.calls[2][3]).toEqual({ forcedSynthesis: true });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Max tool iterations reached, forcing synthesis',
      undefined,
      { maxIterations: 2 }
    );
    expect(result.finalText).toBe('Forced synthesis final answer.');
    expect(result.thought).toBe('Max iterations reached.');
  });

  it('should provide fallback text when forced synthesis returns empty string', async () => {
    const loopCall: ValidToolCall = {
      type: 'valid',
      id: 'call-loop',
      name: 'calculator',
      arguments: {},
    };

    vi.mocked(mockRegistry.executeTool).mockResolvedValue('ok');

    vi.mocked(mockLLM.generateResponse)
      .mockResolvedValueOnce({
        type: 'tool_calls',
        toolCalls: [loopCall],
      })
      .mockResolvedValueOnce({
        type: 'text',
        content: '   ',
      });

    const loop = createAgentLoop({ maxToolIterations: 1 });
    const result = await loop.run(sampleUserMessage, [], defaultTools, mockLogger);

    expect(result.finalText).toBe(
      "I've reached the maximum number of tool iterations and was unable to complete your request."
    );
  });
});
