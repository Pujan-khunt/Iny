import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessIncomingMessage } from '../../../src/core/use-cases/ProcessIncomingMessage';
import { MessageSenderPort } from '../../../src/core/ports/MessageSenderPort';
import { ChatRepositoryPort } from '../../../src/core/ports/ChatRepositoryPort';
import { ContextRetrievalPort } from '../../../src/core/ports/ContextRetrievalPort';
import { ToolRegistryPort, ToolDefinition } from '../../../src/core/ports/ToolRegistryPort';
import { LoggerPort } from '../../../src/core/ports/LoggerPort';
import { AgentLoop } from '../../../src/core/use-cases/AgentLoop';
import { UserMessage, AssistantTextMessage, Message } from '../../../src/core/entities/Message';
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
  let mockContextRetrieval: ContextRetrievalPort;
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
    reasoning: 'Friendly greeting',
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

  const createUseCase = (): ProcessIncomingMessage => {
    return new ProcessIncomingMessage(
      mockSender,
      mockChatRepository,
      mockContextRetrieval,
      mockAgentLoop,
      mockToolRegistry,
      mockLogger
    );
  };

  beforeEach(() => {
    mockSender = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    mockChatRepository = {
      getRecentTurns: vi.fn().mockResolvedValue([]),
      saveTurn: vi.fn().mockResolvedValue(undefined),
      clearHistory: vi.fn().mockResolvedValue(undefined),
    };
    mockContextRetrieval = {
      retrieveContext: vi.fn().mockResolvedValue([]),
    };
    mockAgentLoop = {
      run: vi.fn().mockResolvedValue({
        finalText: sampleAssistantMessage.content,
        reasoning: [sampleAssistantMessage.reasoning!],
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
      const historicalMessages: Message[] = [
        { id: 'm-old-1', userId: 'user1', role: 'user', content: 'Prior question', timestamp: new Date() },
        { id: 'm-old-2', userId: 'user1', role: 'assistant', content: 'Prior answer', timestamp: new Date() },
      ];
      vi.mocked(mockContextRetrieval.retrieveContext).mockResolvedValueOnce(historicalMessages);

      const useCase = createUseCase();
      await useCase.execute(sampleUserMessage);

      // Child logger created with user context
      expect(mockLogger.child).toHaveBeenCalledWith({
        userId: 'user1',
        messageId: 'msg-1',
      });

      // Phase 1: Context retrieval & Reasoning
      expect(mockContextRetrieval.retrieveContext).toHaveBeenCalledWith('user1');
      expect(mockToolRegistry.getToolDefinitions).toHaveBeenCalledTimes(1);
      expect(mockAgentLoop.run).toHaveBeenCalledWith(
        sampleUserMessage,
        historicalMessages,
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
      expect(savedTurn.startedAt).toBeInstanceOf(Date);
      expect(savedTurn.completedAt).toBeInstanceOf(Date);
    });

    it('should save completed turn with startedAt and completedAt timestamps', async () => {
      vi.useFakeTimers();
      try {
        const startTime = new Date('2026-09-29T10:00:00.000Z');
        const endTime = new Date('2026-09-29T10:00:02.500Z');
        vi.setSystemTime(startTime);

        vi.mocked(mockSender.sendMessage).mockImplementationOnce(async () => {
          vi.setSystemTime(endTime);
        });

        const useCase = createUseCase();
        await useCase.execute(sampleUserMessage);

        expect(mockChatRepository.saveTurn).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'user1',
            messages: [sampleUserMessage, sampleAssistantMessage],
            startedAt: startTime,
            completedAt: endTime,
          })
        );

        const savedTurn = (mockChatRepository.saveTurn as any).mock.calls[0][0];
        expect(savedTurn.startedAt).toEqual(startTime);
        expect(savedTurn.completedAt).toEqual(endTime);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Phase 1: Conversation context retrieval', () => {
    it('should retrieve conversation context from ContextRetrievalPort and pass to AgentLoop', async () => {
      const priorMessages: Message[] = [
        { id: 'm-old-1', userId: 'user1', role: 'user', content: 'Prior question', timestamp: new Date() },
      ];
      vi.mocked(mockContextRetrieval.retrieveContext).mockResolvedValueOnce(priorMessages);

      const useCase = createUseCase();
      await useCase.execute(sampleUserMessage);

      expect(mockContextRetrieval.retrieveContext).toHaveBeenCalledWith('user1');
      expect(mockAgentLoop.run).toHaveBeenCalledWith(
        sampleUserMessage,
        priorMessages,
        sampleTools,
        mockChildLogger
      );
    });
  });

  describe('Phase 2: Reasoning error handling', () => {
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

  describe('Phase 3: Delivery error handling', () => {
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

  describe('Phase 4: Persistence error handling', () => {
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
