import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ProcessIncomingMessage,
  ProcessIncomingMessageConfig,
} from '../../../src/core/use-cases/ProcessIncomingMessage';
import { MessageSenderPort } from '../../../src/core/ports/MessageSenderPort';
import { ChatRepositoryPort } from '../../../src/core/ports/ChatRepositoryPort';
import { ToolRegistryPort, ToolDefinition } from '../../../src/core/ports/ToolRegistryPort';
import { LoggerPort } from '../../../src/core/ports/LoggerPort';
import { AgentLoop, AgentLoopResult } from '../../../src/core/use-cases/AgentLoop';
import { UserMessage, AssistantTextMessage } from '../../../src/core/entities/Message';
import { DialogueTurn } from '../../../src/core/entities/DialogueTurn';
import {
  LLMAuthenticationError,
  LLMInsufficientBalanceError,
  LLMRateLimitError,
  LLMServerOverloadedError,
  LLMServerError,
} from '../../../src/core/errors/LLMErrors';

describe('ProcessIncomingMessage', () => {
  let mockSender: MessageSenderPort;
  let mockChatRepository: ChatRepositoryPort;
  let mockAgentLoop: AgentLoop;
  let mockToolRegistry: ToolRegistryPort;
  let mockLogger: LoggerPort;
  let mockChildLogger: LoggerPort;

  const sampleTools: ToolDefinition[] = [
    {
      name: 'calculator',
      description: 'Calculates math expressions',
      schema: { type: 'object' },
    },
  ];

  const sampleUserMessage: UserMessage = {
    id: 'msg-1',
    userId: 'user1',
    role: 'user',
    content: 'Hello Iny',
    timestamp: new Date('2026-09-23T10:00:00Z'),
  };

  const sampleAssistantMessage: AssistantTextMessage = {
    id: 'asst-msg-1',
    userId: 'user1',
    role: 'assistant',
    content: 'Hello! How can I help you today?',
    thought: 'Friendly greeting',
    timestamp: new Date('2026-09-23T10:00:01Z'),
  };

  const createMockLogger = (): LoggerPort => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  });

  const createUseCase = (
    config?: ProcessIncomingMessageConfig
  ): ProcessIncomingMessage => {
    return new ProcessIncomingMessage(
      mockSender,
      mockChatRepository,
      mockAgentLoop,
      mockToolRegistry,
      mockLogger,
      config
    );
  };

  beforeEach(() => {
    mockSender = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    mockChatRepository = {
      getRecentTurns: vi.fn().mockResolvedValue([]),
      saveTurn: vi.fn().mockResolvedValue(undefined),
      clearHistory: vi.fn().mockResolvedValue(undefined),
    };
    mockAgentLoop = {
      run: vi.fn().mockResolvedValue({
        finalText: sampleAssistantMessage.content,
        thought: sampleAssistantMessage.thought,
        sessionMessages: [sampleUserMessage, sampleAssistantMessage],
      }),
    } as unknown as AgentLoop;
    mockToolRegistry = {
      getToolDefinitions: vi.fn().mockReturnValue(sampleTools),
      executeTool: vi.fn(),
    };
    mockChildLogger = createMockLogger();
    mockLogger = createMockLogger();
    vi.mocked(mockLogger.child).mockReturnValue(mockChildLogger);
  });

  describe('Happy path (Reasoning -> Delivery -> Persistence)', () => {
    it('should coordinate all 4 phases and persist valid dialogue turn', async () => {
      const historicalTurn: DialogueTurn = {
        id: 'turn-old',
        userId: 'user1',
        messages: [
          { id: 'm-old-1', userId: 'user1', role: 'user', content: 'Prior question', timestamp: new Date() },
          { id: 'm-old-2', userId: 'user1', role: 'assistant', content: 'Prior answer', timestamp: new Date() },
        ],
        createdAt: new Date(),
      };
      vi.mocked(mockChatRepository.getRecentTurns).mockResolvedValueOnce([historicalTurn]);

      const useCase = createUseCase();
      await useCase.execute(sampleUserMessage);

      // Child logger created with user context
      expect(mockLogger.child).toHaveBeenCalledWith({
        userId: 'user1',
        messageId: 'msg-1',
      });

      // Phase 1: Reasoning
      expect(mockChatRepository.getRecentTurns).toHaveBeenCalledWith('user1', 10);
      expect(mockToolRegistry.getToolDefinitions).toHaveBeenCalledTimes(1);
      expect(mockAgentLoop.run).toHaveBeenCalledWith(
        sampleUserMessage,
        historicalTurn.messages,
        sampleTools,
        mockChildLogger
      );

      // Phase 2: Delivery
      expect(mockSender.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockSender.sendMessage).toHaveBeenCalledWith('user1', 'Hello! How can I help you today?');

      // Phase 3: Persistence
      expect(mockChatRepository.saveTurn).toHaveBeenCalledTimes(1);
      const savedTurn = vi.mocked(mockChatRepository.saveTurn).mock.calls[0][0];
      expect(savedTurn.userId).toBe('user1');
      expect(savedTurn.messages).toEqual([sampleUserMessage, sampleAssistantMessage]);
      expect(savedTurn.createdAt).toBeInstanceOf(Date);
    });

    it('should respect custom maxHistoryTurns configuration', async () => {
      const useCase = createUseCase({ maxHistoryTurns: 3 });
      await useCase.execute(sampleUserMessage);

      expect(mockChatRepository.getRecentTurns).toHaveBeenCalledWith('user1', 3);
    });
  });

  describe('Phase 1: Reasoning error handling', () => {
    it('should handle generic reasoning error and send fallback notification', async () => {
      const reasoningError = new LLMServerError('Service unavailable', { status: 503 });
      vi.mocked(mockAgentLoop.run).mockRejectedValueOnce(reasoningError);

      const useCase = createUseCase();
      await useCase.execute(sampleUserMessage);

      expect(mockChildLogger.error).toHaveBeenCalled();
      expect(mockSender.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockSender.sendMessage).toHaveBeenCalledWith('user1', 'An error occurred during processing.');
      expect(mockChatRepository.saveTurn).not.toHaveBeenCalled();
    });

    it('should log fatal error when authentication fails during reasoning', async () => {
      const authError = new LLMAuthenticationError('Invalid API key', {
        status: 401,
        code: 'invalid_api_key',
      });
      vi.mocked(mockAgentLoop.run).mockRejectedValueOnce(authError);

      const useCase = createUseCase();
      await useCase.execute(sampleUserMessage);

      expect(mockChildLogger.fatal).toHaveBeenCalledWith(
        expect.any(String),
        authError,
        { status: 401, code: 'invalid_api_key' }
      );
      expect(mockSender.sendMessage).toHaveBeenCalledWith('user1', 'An error occurred during processing.');
      expect(mockChatRepository.saveTurn).not.toHaveBeenCalled();
    });

    it('should log fatal error when LLM account has insufficient balance', async () => {
      const balanceError = new LLMInsufficientBalanceError('Quota exceeded', {
        status: 402,
        code: 'insufficient_balance',
      });
      vi.mocked(mockAgentLoop.run).mockRejectedValueOnce(balanceError);

      const useCase = createUseCase();
      await useCase.execute(sampleUserMessage);

      expect(mockChildLogger.fatal).toHaveBeenCalledWith(
        expect.any(String),
        balanceError,
        { status: 402, code: 'insufficient_balance' }
      );
      expect(mockSender.sendMessage).toHaveBeenCalledWith('user1', 'An error occurred during processing.');
      expect(mockChatRepository.saveTurn).not.toHaveBeenCalled();
    });

    it('should inform user of high traffic on rate limit errors', async () => {
      const rateLimitError = new LLMRateLimitError('Too many requests', { status: 429 });
      vi.mocked(mockAgentLoop.run).mockRejectedValueOnce(rateLimitError);

      const useCase = createUseCase();
      await useCase.execute(sampleUserMessage);

      expect(mockSender.sendMessage).toHaveBeenCalledWith(
        'user1',
        'Iny is experiencing heavy traffic right now. Please try again in a moment.'
      );
      expect(mockChatRepository.saveTurn).not.toHaveBeenCalled();
    });

    it('should inform user of high traffic on server overloaded errors', async () => {
      const overloadedError = new LLMServerOverloadedError('Server overloaded', { status: 503 });
      vi.mocked(mockAgentLoop.run).mockRejectedValueOnce(overloadedError);

      const useCase = createUseCase();
      await useCase.execute(sampleUserMessage);

      expect(mockSender.sendMessage).toHaveBeenCalledWith(
        'user1',
        'Iny is experiencing heavy traffic right now. Please try again in a moment.'
      );
      expect(mockChatRepository.saveTurn).not.toHaveBeenCalled();
    });

    it('should safely catch and log error if sending fallback message also fails', async () => {
      vi.mocked(mockAgentLoop.run).mockRejectedValueOnce(new Error('Reasoning crashed'));
      vi.mocked(mockSender.sendMessage).mockRejectedValueOnce(new Error('Transport disconnected'));

      const useCase = createUseCase();
      await expect(useCase.execute(sampleUserMessage)).resolves.toBeUndefined();

      expect(mockChildLogger.error).toHaveBeenCalled();
      expect(mockChatRepository.saveTurn).not.toHaveBeenCalled();
    });
  });

  describe('Phase 2: Delivery error handling', () => {
    it('should log transport error and not attempt retry or turn persistence', async () => {
      const transportError = new Error('WhatsApp socket closed');
      vi.mocked(mockSender.sendMessage).mockRejectedValueOnce(transportError);

      const useCase = createUseCase();
      await useCase.execute(sampleUserMessage);

      expect(mockSender.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockSender.sendMessage).toHaveBeenCalledWith('user1', 'Hello! How can I help you today?');
      expect(mockChildLogger.error).toHaveBeenCalledWith(
        'Failed to deliver message to user via transport',
        transportError
      );
      // Turn must NOT be saved when delivery fails
      expect(mockChatRepository.saveTurn).not.toHaveBeenCalled();
    });
  });

  describe('Phase 3: Persistence error handling', () => {
    it('should log persistence error without sending duplicate message to user', async () => {
      const dbError = new Error('Database write constraint failed');
      vi.mocked(mockChatRepository.saveTurn).mockRejectedValueOnce(dbError);

      const useCase = createUseCase();
      await useCase.execute(sampleUserMessage);

      // User received response once
      expect(mockSender.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockSender.sendMessage).toHaveBeenCalledWith('user1', 'Hello! How can I help you today?');

      // Persistence failed, error logged
      expect(mockChildLogger.error).toHaveBeenCalledWith('Failed to persist dialogue turn', dbError);
    });
  });
});
