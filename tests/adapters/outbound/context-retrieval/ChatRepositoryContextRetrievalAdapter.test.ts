import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatRepositoryContextRetrievalAdapter } from '../../../../src/adapters/outbound/context-retrieval/ChatRepositoryContextRetrievalAdapter';
import { ChatRepositoryPort } from '../../../../src/core/ports/ChatRepositoryPort';
import { LoggerPort } from '../../../../src/core/ports/LoggerPort';
import { DialogueTurn } from '../../../../src/core/entities/DialogueTurn';
import { UserMessage, AssistantTextMessage } from '../../../../src/core/entities/Message';

describe('ChatRepositoryContextRetrievalAdapter', () => {
  let mockChatRepository: ChatRepositoryPort;
  let mockLogger: LoggerPort;

  const userMsg1: UserMessage = {
    id: 'u1',
    userId: 'user1',
    role: 'user',
    content: 'First question',
    timestamp: new Date('2026-09-20T10:00:00Z'),
  };
  const asstMsg1: AssistantTextMessage = {
    id: 'a1',
    userId: 'user1',
    role: 'assistant',
    content: 'First answer',
    timestamp: new Date('2026-09-20T10:00:01Z'),
  };
  const turn1: DialogueTurn = {
    id: 'turn-1',
    userId: 'user1',
    messages: [userMsg1, asstMsg1],
    startedAt: new Date('2026-09-20T10:00:00Z'),
    completedAt: new Date('2026-09-20T10:00:02Z'),
  };

  const userMsg2: UserMessage = {
    id: 'u2',
    userId: 'user1',
    role: 'user',
    content: 'Second question',
    timestamp: new Date('2026-09-20T11:00:00Z'),
  };
  const asstMsg2: AssistantTextMessage = {
    id: 'a2',
    userId: 'user1',
    role: 'assistant',
    content: 'Second answer',
    timestamp: new Date('2026-09-20T11:00:01Z'),
  };
  const turn2: DialogueTurn = {
    id: 'turn-2',
    userId: 'user1',
    messages: [userMsg2, asstMsg2],
    startedAt: new Date('2026-09-20T11:00:00Z'),
    completedAt: new Date('2026-09-20T11:00:02Z'),
  };

  beforeEach(() => {
    mockChatRepository = {
      getRecentTurns: vi.fn().mockResolvedValue([turn1, turn2]),
      saveTurn: vi.fn(),
      clearHistory: vi.fn(),
    };
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
  });

  it('should retrieve turns using default maxTurns and flatten to Message array', async () => {
    const adapter = new ChatRepositoryContextRetrievalAdapter(mockChatRepository, mockLogger);
    const messages = await adapter.retrieveContext('user1');

    expect(mockChatRepository.getRecentTurns).toHaveBeenCalledWith('user1', 10);
    expect(messages).toEqual([userMsg1, asstMsg1, userMsg2, asstMsg2]);
  });

  it('should respect custom maxTurns in config', async () => {
    const adapter = new ChatRepositoryContextRetrievalAdapter(mockChatRepository, mockLogger, {
      maxTurns: 5,
    });
    await adapter.retrieveContext('user1');

    expect(mockChatRepository.getRecentTurns).toHaveBeenCalledWith('user1', 5);
  });

  it('should filter out turns exceeding TTL window when ttlMs is provided', async () => {
    vi.useFakeTimers();
    try {
      // Set current time to 2026-09-20T11:30:00Z (30 min after turn2, 90 min after turn1)
      vi.setSystemTime(new Date('2026-09-20T11:30:00Z'));

      // 1 hour TTL (3600000 ms) -> turn1 (90m ago) expired, turn2 (30m ago) valid
      const adapter = new ChatRepositoryContextRetrievalAdapter(mockChatRepository, mockLogger, {
        ttlMs: 3600000,
      });

      const messages = await adapter.retrieveContext('user1');
      expect(messages).toEqual([userMsg2, asstMsg2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should return empty array and log warning when chatRepository throws', async () => {
    const error = new Error('Database connection failed');
    vi.mocked(mockChatRepository.getRecentTurns).mockRejectedValueOnce(error);

    const adapter = new ChatRepositoryContextRetrievalAdapter(mockChatRepository, mockLogger);
    const messages = await adapter.retrieveContext('user1');

    expect(messages).toEqual([]);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to load conversation history from database, proceeding with empty context',
      error,
      { userId: 'user1' }
    );
  });
});
