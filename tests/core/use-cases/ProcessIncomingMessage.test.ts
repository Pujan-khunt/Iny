import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ProcessIncomingMessage,
  ProcessIncomingMessageConfig,
} from '../../../src/core/use-cases/ProcessIncomingMessage';
import { MessageSenderPort } from '../../../src/core/ports/MessageSenderPort';
import { LLMPort } from '../../../src/core/ports/LLMPort';
import { PluginRegistryPort, Plugin } from '../../../src/core/ports/PluginRegistryPort';
import { ChatRepositoryPort } from '../../../src/core/ports/ChatRepositoryPort';
import { UserMessage } from '../../../src/core/entities/Message';
import { DialogueTurn } from '../../../src/core/entities/DialogueTurn';
import { LoggerPort } from '../../../src/core/ports/LoggerPort';

describe('ProcessIncomingMessage', () => {
  let mockSender: MessageSenderPort;
  let mockLLM: LLMPort;
  let mockRegistry: PluginRegistryPort;
  let mockChatRepository: ChatRepositoryPort;
  let mockLogger: LoggerPort;
  let mockChildLogger: LoggerPort;

  const defaultSystemPrompt = 'You are Iny, a friendly assistant.';

  const createUseCase = (
    configOverrides?: Partial<ProcessIncomingMessageConfig>
  ): ProcessIncomingMessage => {
    return new ProcessIncomingMessage(
      mockSender,
      mockLLM,
      mockRegistry,
      mockChatRepository,
      mockLogger,
      {
        systemPrompt: defaultSystemPrompt,
        ...configOverrides,
      }
    );
  };

  const createMockLogger = (): LoggerPort => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  });

  beforeEach(() => {
    mockSender = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    mockLLM = { generateResponse: vi.fn() };
    mockRegistry = { getAvailablePlugins: vi.fn().mockReturnValue([]), executePlugin: vi.fn() };
    mockChatRepository = {
      getRecentTurns: vi.fn().mockResolvedValue([]),
      saveTurn: vi.fn().mockResolvedValue(undefined),
      clearHistory: vi.fn().mockResolvedValue(undefined),
    };
    mockChildLogger = createMockLogger();
    mockLogger = createMockLogger();
    vi.mocked(mockLogger.child).mockReturnValue(mockChildLogger);
  });

  it('should process a message, send text response, and save dialogue turn', async () => {
    vi.mocked(mockLLM.generateResponse).mockResolvedValue({
      type: 'text',
      content: 'Hello back!',
      thought: 'Greeting the user',
    });

    const useCase = createUseCase();

    const message: UserMessage = {
      id: 'msg-1',
      userId: 'user1',
      role: 'user',
      content: 'Hi',
      timestamp: new Date(),
    };

    await useCase.execute(message);

    expect(mockLogger.child).toHaveBeenCalledWith({ userId: 'user1', messageId: 'msg-1' });
    expect(mockChatRepository.getRecentTurns).toHaveBeenCalledWith('user1', 10);
    expect(mockLLM.generateResponse).toHaveBeenCalledWith(
      defaultSystemPrompt,
      [message],
      []
    );
    expect(mockSender.sendMessage).toHaveBeenCalledWith('user1', 'Hello back!');
    expect(mockChatRepository.saveTurn).toHaveBeenCalledTimes(1);
    const savedTurn = vi.mocked(mockChatRepository.saveTurn).mock.calls[0][0];
    expect(savedTurn.userId).toBe('user1');
    expect(savedTurn.messages).toHaveLength(2);
    expect(savedTurn.messages[0]).toEqual(message);
    expect(savedTurn.messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Hello back!',
      thought: 'Greeting the user',
      userId: 'user1',
    });
    expect(mockChildLogger.info).toHaveBeenCalledWith('Message processed successfully');
  });

  it('should execute tool and feed result back to LLM before delivering final response', async () => {
    const mockPlugin: Plugin = {
      name: 'calculator',
      description: 'Calculate expressions',
      schema: {},
      execute: vi.fn().mockResolvedValue('4'),
    };
    vi.mocked(mockRegistry.getAvailablePlugins).mockReturnValue([mockPlugin]);
    vi.mocked(mockRegistry.executePlugin).mockResolvedValue('4');

    vi.mocked(mockLLM.generateResponse)
      .mockResolvedValueOnce({
        type: 'tool_calls',
        toolCalls: [
          {
            id: 'call-1',
            name: 'calculator',
            arguments: { expr: '2+2' },
          },
        ],
        thought: 'Need to compute 2+2',
      })
      .mockResolvedValueOnce({
        type: 'text',
        content: 'The answer is 4.',
      });

    const useCase = createUseCase();

    const message: UserMessage = {
      id: 'msg-2',
      userId: 'user2',
      role: 'user',
      content: 'What is 2+2?',
      timestamp: new Date(),
    };

    await useCase.execute(message);

    expect(mockRegistry.executePlugin).toHaveBeenCalledWith('calculator', { expr: '2+2' });
    expect(mockLLM.generateResponse).toHaveBeenCalledTimes(2);

    const secondCallHistory = vi.mocked(mockLLM.generateResponse).mock.calls[1][1];
    expect(secondCallHistory).toHaveLength(3);
    expect(secondCallHistory[0]).toEqual(message);
    expect(secondCallHistory[1]).toMatchObject({
      role: 'assistant',
      thought: 'Need to compute 2+2',
      toolCalls: [{ id: 'call-1', name: 'calculator', arguments: { expr: '2+2' } }],
    });
    expect(secondCallHistory[2]).toMatchObject({
      role: 'tool',
      toolCallId: 'call-1',
      name: 'calculator',
      content: '4',
    });

    expect(mockSender.sendMessage).toHaveBeenCalledWith('user2', 'The answer is 4.');
    expect(mockChatRepository.saveTurn).toHaveBeenCalledTimes(1);
    const savedTurn = vi.mocked(mockChatRepository.saveTurn).mock.calls[0][0];
    expect(savedTurn.messages).toHaveLength(4);
  });

  it('should execute parallel tool calls concurrently via Promise.all and feed all results back to LLM', async () => {
    const executionOrder: string[] = [];
    vi.mocked(mockRegistry.executePlugin).mockImplementation(async (name) => {
      executionOrder.push(`start:${name}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      executionOrder.push(`end:${name}`);
      return `result-${name}`;
    });

    vi.mocked(mockLLM.generateResponse)
      .mockResolvedValueOnce({
        type: 'tool_calls',
        toolCalls: [
          { id: 'call-1', name: 'weather', arguments: { city: 'Tokyo' } },
          { id: 'call-2', name: 'time', arguments: { timezone: 'Asia/Tokyo' } },
        ],
      })
      .mockResolvedValueOnce({
        type: 'text',
        content: 'Tokyo is sunny and 3 PM.',
      });

    const useCase = createUseCase();

    const message: UserMessage = {
      id: 'msg-3',
      userId: 'user3',
      role: 'user',
      content: 'Tokyo weather and time',
      timestamp: new Date(),
    };

    await useCase.execute(message);

    expect(executionOrder[0]).toBe('start:weather');
    expect(executionOrder[1]).toBe('start:time');

    expect(mockLLM.generateResponse).toHaveBeenCalledTimes(2);
    const secondCallHistory = vi.mocked(mockLLM.generateResponse).mock.calls[1][1];
    expect(secondCallHistory).toHaveLength(4);
    expect(secondCallHistory[2]).toMatchObject({
      role: 'tool',
      toolCallId: 'call-1',
      name: 'weather',
      content: 'result-weather',
    });
    expect(secondCallHistory[3]).toMatchObject({
      role: 'tool',
      toolCallId: 'call-2',
      name: 'time',
      content: 'result-time',
    });

    expect(mockSender.sendMessage).toHaveBeenCalledWith('user3', 'Tokyo is sunny and 3 PM.');
  });

  it('should serialize plugin execution error into ToolMessage and allow LLM to self-correct', async () => {
    vi.mocked(mockRegistry.executePlugin).mockRejectedValue(new Error('Network timeout'));

    vi.mocked(mockLLM.generateResponse)
      .mockResolvedValueOnce({
        type: 'tool_calls',
        toolCalls: [{ id: 'call-fail', name: 'flakyApi', arguments: {} }],
      })
      .mockResolvedValueOnce({
        type: 'text',
        content: 'Sorry, the service experienced a network timeout.',
      });

    const useCase = createUseCase();

    const message: UserMessage = {
      id: 'msg-4',
      userId: 'user4',
      role: 'user',
      content: 'Get data',
      timestamp: new Date(),
    };

    await useCase.execute(message);

    expect(mockLLM.generateResponse).toHaveBeenCalledTimes(2);
    const secondCallHistory = vi.mocked(mockLLM.generateResponse).mock.calls[1][1];
    expect(secondCallHistory[2]).toMatchObject({
      role: 'tool',
      toolCallId: 'call-fail',
      name: 'flakyApi',
      content: "Error executing tool 'flakyApi': Network timeout",
    });
    expect(mockSender.sendMessage).toHaveBeenCalledWith(
      'user4',
      'Sorry, the service experienced a network timeout.'
    );
    expect(mockChatRepository.saveTurn).toHaveBeenCalledTimes(1);
  });

  it('should hit circuit breaker when maxToolIterations is reached and trigger forced synthesis', async () => {
    vi.mocked(mockRegistry.executePlugin).mockResolvedValue('ok');

    vi.mocked(mockLLM.generateResponse)
      .mockResolvedValueOnce({
        type: 'tool_calls',
        toolCalls: [{ id: 'c1', name: 'loopTool', arguments: {} }],
      })
      .mockResolvedValueOnce({
        type: 'tool_calls',
        toolCalls: [{ id: 'c2', name: 'loopTool', arguments: {} }],
      })
      .mockResolvedValueOnce({
        type: 'text',
        content: 'Synthesized conclusion after hitting limit.',
      });

    const useCase = createUseCase({ maxToolIterations: 2 });

    const message: UserMessage = {
      id: 'msg-5',
      userId: 'user5',
      role: 'user',
      content: 'Infinite loop please',
      timestamp: new Date(),
    };

    await useCase.execute(message);

    expect(mockLLM.generateResponse).toHaveBeenCalledTimes(3);
    expect(vi.mocked(mockLLM.generateResponse).mock.calls[2][3]).toEqual({ forcedSynthesis: true });
    expect(mockSender.sendMessage).toHaveBeenCalledWith(
      'user5',
      'Synthesized conclusion after hitting limit.'
    );
    expect(mockChatRepository.saveTurn).toHaveBeenCalledTimes(1);
    const savedTurn = vi.mocked(mockChatRepository.saveTurn).mock.calls[0][0];
    const lastMessage = savedTurn.messages[savedTurn.messages.length - 1];
    expect(lastMessage).toMatchObject({
      role: 'assistant',
      content: 'Synthesized conclusion after hitting limit.',
    });
  });

  it('should use fallback message if forced synthesis returns empty string or whitespace', async () => {
    vi.mocked(mockRegistry.executePlugin).mockResolvedValue('ok');

    vi.mocked(mockLLM.generateResponse)
      .mockResolvedValueOnce({
        type: 'tool_calls',
        toolCalls: [{ id: 'c1', name: 'loopTool', arguments: {} }],
      })
      .mockResolvedValueOnce({
        type: 'text',
        content: '   ',
      });

    const useCase = createUseCase({ maxToolIterations: 1 });

    const message: UserMessage = {
      id: 'msg-empty-synthesis',
      userId: 'user-empty',
      role: 'user',
      content: 'Loop forever',
      timestamp: new Date(),
    };

    await useCase.execute(message);

    expect(mockSender.sendMessage).toHaveBeenCalledWith(
      'user-empty',
      "I've reached the maximum number of tool iterations and was unable to complete your request."
    );
    expect(mockChatRepository.saveTurn).toHaveBeenCalledTimes(1);
    const savedTurn = vi.mocked(mockChatRepository.saveTurn).mock.calls[0][0];
    const lastMessage = savedTurn.messages[savedTurn.messages.length - 1];
    expect(lastMessage).toMatchObject({
      role: 'assistant',
      content: "I've reached the maximum number of tool iterations and was unable to complete your request.",
    });
  });

  it('should retrieve historical turns from repository and prepend to LLM working history', async () => {
    const previousTurn: DialogueTurn = {
      id: 'turn-old',
      userId: 'user6',
      messages: [
        { id: 'm1', userId: 'user6', role: 'user', content: 'My name is Alice', timestamp: new Date() },
        { id: 'm2', userId: 'user6', role: 'assistant', content: 'Hello Alice!', timestamp: new Date() },
      ],
      createdAt: new Date(),
    };

    vi.mocked(mockChatRepository.getRecentTurns).mockResolvedValue([previousTurn]);
    vi.mocked(mockLLM.generateResponse).mockResolvedValue({
      type: 'text',
      content: 'Your name is Alice.',
    });

    const useCase = createUseCase({ maxHistoryTurns: 5 });

    const message: UserMessage = {
      id: 'msg-6',
      userId: 'user6',
      role: 'user',
      content: 'What is my name?',
      timestamp: new Date(),
    };

    await useCase.execute(message);

    expect(mockChatRepository.getRecentTurns).toHaveBeenCalledWith('user6', 5);
    expect(mockLLM.generateResponse).toHaveBeenCalledWith(
      expect.any(String),
      [
        previousTurn.messages[0],
        previousTurn.messages[1],
        message,
      ],
      []
    );
    expect(mockSender.sendMessage).toHaveBeenCalledWith('user6', 'Your name is Alice.');

    expect(mockChatRepository.saveTurn).toHaveBeenCalledTimes(1);
    const savedTurn = vi.mocked(mockChatRepository.saveTurn).mock.calls[0][0];
    expect(savedTurn.messages).toHaveLength(2);
    expect(savedTurn.messages[0]).toEqual(message);
    expect(savedTurn.messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Your name is Alice.',
    });
  });

  it('should log error and send generic error message if an unhandled error occurs', async () => {
    const crashError = new Error('Database connection dropped');
    vi.mocked(mockChatRepository.getRecentTurns).mockRejectedValue(crashError);

    const useCase = createUseCase();

    const message: UserMessage = {
      id: 'msg-7',
      userId: 'user7',
      role: 'user',
      content: 'Crash test',
      timestamp: new Date(),
    };

    await useCase.execute(message);

    expect(mockChildLogger.error).toHaveBeenCalledWith('Failed to process message', crashError);
    expect(mockSender.sendMessage).toHaveBeenCalledWith('user7', 'An error occurred during processing.');
    expect(mockChatRepository.saveTurn).not.toHaveBeenCalled();
  });

  it('should catch and log error if sender.sendMessage fails while delivering generic error message', async () => {
    const crashError = new Error('Database connection dropped');
    const sendError = new Error('WhatsApp transport disconnected');
    vi.mocked(mockChatRepository.getRecentTurns).mockRejectedValue(crashError);
    vi.mocked(mockSender.sendMessage).mockRejectedValue(sendError);

    const useCase = createUseCase();

    const message: UserMessage = {
      id: 'msg-err-delivery',
      userId: 'user-err',
      role: 'user',
      content: 'Crash test with failing sender',
      timestamp: new Date(),
    };

    await expect(useCase.execute(message)).resolves.toBeUndefined();

    expect(mockChildLogger.error).toHaveBeenCalledWith('Failed to process message', crashError);
    expect(mockChildLogger.error).toHaveBeenCalledWith(
      'Failed to send error notification to user',
      sendError
    );
  });

  it('should use custom systemPrompt when provided in config', async () => {
    vi.mocked(mockLLM.generateResponse).mockResolvedValue({
      type: 'text',
      content: 'Custom response',
    });

    const customPrompt = 'You are a specialized math tutor. Explain steps thoroughly.';
    const useCase = createUseCase({ systemPrompt: customPrompt });

    const message: UserMessage = {
      id: 'msg-custom-prompt',
      userId: 'user-prompt',
      role: 'user',
      content: 'Hello',
      timestamp: new Date(),
    };

    await useCase.execute(message);

    expect(mockLLM.generateResponse).toHaveBeenCalledWith(
      customPrompt,
      [message],
      []
    );
  });

  it('should throw if systemPrompt is missing or undefined in config', () => {
    expect(
      () =>
        new ProcessIncomingMessage(
          mockSender,
          mockLLM,
          mockRegistry,
          mockChatRepository,
          mockLogger,
          {} as any
        )
    ).toThrow('systemPrompt is required');
  });

  it('should throw if systemPrompt is empty or whitespace', () => {
    expect(
      () =>
        new ProcessIncomingMessage(
          mockSender,
          mockLLM,
          mockRegistry,
          mockChatRepository,
          mockLogger,
          { systemPrompt: '   ' }
        )
    ).toThrow('systemPrompt is required');
  });
});
