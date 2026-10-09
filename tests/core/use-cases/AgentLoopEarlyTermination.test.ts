import { describe, it, expect, vi } from 'vitest';
import {
  AgentLoop,
  shouldTerminateEarly,
  formatTerminalToolOutputs,
  formatMessageTimeIST,
  buildTemporallyGroundedSystemPrompt,
  ToolExecutionOutcome,
  TERMINAL_OUTPUT_SEPARATOR,
} from '../../../src/core/use-cases/AgentLoop';
import { ToolRegistryPort } from '../../../src/core/ports/ToolRegistryPort';
import { LLMPort } from '../../../src/core/ports/LLMPort';
import { LoggerPort } from '../../../src/core/ports/LoggerPort';
import { MessageFactory, AssistantTextMessage } from '../../../src/core/entities/Message';
import { ToolCallRequestFactory } from '../../../src/core/entities/ToolCallRequest';

describe('AgentLoop Pure Helper Functions', () => {
  describe('formatMessageTimeIST & buildTemporallyGroundedSystemPrompt', () => {
    it('formats a known UTC Date correctly into IST representation', () => {
      // 2026-10-12T09:00:00Z is 2:30 PM IST (14:30)
      const date = new Date('2026-10-12T09:00:00.000Z');
      const formatted = formatMessageTimeIST(date);
      expect(formatted).toContain('2026');
      expect(formatted).toContain('October');
      expect(formatted).toContain('12');
    });

    it('injects formatted IST timestamp into base system prompt', () => {
      const date = new Date('2026-10-12T09:00:00.000Z');
      const basePrompt = 'You are a campus dining assistant.';
      const groundedPrompt = buildTemporallyGroundedSystemPrompt(basePrompt, date);
      const expectedTimeStr = formatMessageTimeIST(date);
      expect(groundedPrompt).toBe(`${basePrompt}\n\n[Current Time (IST): ${expectedTimeStr}]`);
    });
  });

  describe('shouldTerminateEarly', () => {
    const createOutcome = (isError: boolean, isTerminal: boolean, content = 'card'): ToolExecutionOutcome => ({
      message: MessageFactory.createToolResult({
        userId: 'u1',
        toolCallId: 'tc1',
        name: 'test_tool',
        content,
      }),
      toolResult: { content, isTerminal },
      isError,
    });

    it('returns false when no tool calls were executed', () => {
      expect(shouldTerminateEarly([])).toBe(false);
    });

    it('returns true when a single tool succeeds and is terminal', () => {
      const outcomes = [createOutcome(false, true)];
      expect(shouldTerminateEarly(outcomes)).toBe(true);
    });

    it('returns true when multiple tools all succeed and are all terminal', () => {
      const outcomes = [createOutcome(false, true, 'card1'), createOutcome(false, true, 'card2')];
      expect(shouldTerminateEarly(outcomes)).toBe(true);
    });

    it('returns false when any tool execution resulted in an error', () => {
      const outcomes = [createOutcome(false, true), createOutcome(true, true)];
      expect(shouldTerminateEarly(outcomes)).toBe(false);
    });

    it('returns false when any tool in the batch is non-terminal', () => {
      const outcomes = [createOutcome(false, true), createOutcome(false, false)];
      expect(shouldTerminateEarly(outcomes)).toBe(false);
    });
  });

  describe('formatTerminalToolOutputs', () => {
    it('joins multiple terminal outputs with canonical separator', () => {
      const outcomes: ToolExecutionOutcome[] = [
        {
          message: MessageFactory.createToolResult({ userId: 'u1', toolCallId: '1', name: 't1', content: 'Output 1' }),
          toolResult: { content: 'Output 1', isTerminal: true },
          isError: false,
        },
        {
          message: MessageFactory.createToolResult({ userId: 'u1', toolCallId: '2', name: 't2', content: 'Output 2' }),
          toolResult: { content: 'Output 2', isTerminal: true },
          isError: false,
        },
      ];
      expect(formatTerminalToolOutputs(outcomes)).toBe(`Output 1${TERMINAL_OUTPUT_SEPARATOR}Output 2`);
    });
  });
});

describe('AgentLoop Early Termination (All-or-Nothing)', () => {
  const mockLogger: LoggerPort = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: () => mockLogger,
  };

  it('terminates immediately when a terminal tool succeeds and all batch tools succeed', async () => {
    const mockToolRegistry: ToolRegistryPort = {
      getToolDefinitions: vi.fn().mockReturnValue([]),
      executeTool: vi.fn().mockImplementation(async (name) => {
        if (name === 'display_mess_card') {
          return { content: '*LUNCH MENU*', isTerminal: true };
        }
        throw new Error(`Tool "${name}" not found.`);
      }),
    };

    const mockLlm: LLMPort = {
      generateResponse: vi.fn().mockResolvedValueOnce({
        type: 'tool_calls',
        toolCalls: [
          ToolCallRequestFactory.createValid({
            id: 'call_1',
            name: 'display_mess_card',
            arguments: {},
          }),
        ],
      }),
    };

    const loop = new AgentLoop(mockLlm, mockToolRegistry, { systemPrompt: 'Test prompt' });
    const userMessage = MessageFactory.createUser({ userId: 'user_123', content: 'what is for lunch' });
    const result = await loop.run(userMessage, [], [], mockLogger);

    // LLM must only be called ONCE (no 2nd round-trip synthesis)
    expect(mockLlm.generateResponse).toHaveBeenCalledTimes(1);
    // Assistant text message must match terminal content exactly
    expect(result.finalText).toBe('*LUNCH MENU*');
    // Dialogue turn messages array must include userMessage, assistantToolCall, toolResult, assistantTextMessage
    expect(result.sessionMessages).toHaveLength(4);
    expect(result.sessionMessages[0].role).toBe('user');
    expect(result.sessionMessages[1].role).toBe('assistant');
    expect(result.sessionMessages[2].role).toBe('tool');
    expect(result.sessionMessages[3].role).toBe('assistant');
    expect((result.sessionMessages[3] as AssistantTextMessage).content).toBe('*LUNCH MENU*');
  });

  it('falls back to LLM synthesis if a terminal tool succeeds but another batch tool fails', async () => {
    const mockToolRegistry: ToolRegistryPort = {
      getToolDefinitions: vi.fn().mockReturnValue([]),
      executeTool: vi.fn().mockImplementation(async (name) => {
        if (name === 'display_mess_card') {
          return { content: '*LUNCH MENU*', isTerminal: true };
        }
        if (name === 'other_tool') {
          throw new Error('Boom');
        }
        throw new Error(`Tool "${name}" not found.`);
      }),
    };

    const mockLlm: LLMPort = {
      generateResponse: vi
        .fn()
        .mockResolvedValueOnce({
          type: 'tool_calls',
          toolCalls: [
            ToolCallRequestFactory.createValid({
              id: 'call_1',
              name: 'display_mess_card',
              arguments: {},
            }),
            ToolCallRequestFactory.createValid({
              id: 'call_2',
              name: 'other_tool',
              arguments: {},
            }),
          ],
        })
        .mockResolvedValueOnce({
          type: 'text',
          content: 'One tool failed',
        }),
    };

    const loop = new AgentLoop(mockLlm, mockToolRegistry, { systemPrompt: 'Test prompt' });
    const userMessage = MessageFactory.createUser({ userId: 'user_123', content: 'mixed tools' });
    const result = await loop.run(userMessage, [], [], mockLogger);

    // Must have fallen back to second LLM synthesis turn
    expect(mockLlm.generateResponse).toHaveBeenCalledTimes(2);
    expect(result.finalText).toBe('One tool failed');
    expect((result.sessionMessages[result.sessionMessages.length - 1] as AssistantTextMessage).content).toBe(
      'One tool failed'
    );
  });
});
