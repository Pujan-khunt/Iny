import { ContextRetrievalPort } from '../../../core/ports/ContextRetrievalPort';
import { ChatRepositoryPort } from '../../../core/ports/ChatRepositoryPort';
import { LoggerPort } from '../../../core/ports/LoggerPort';
import { Message } from '../../../core/entities/Message';

export interface ChatRepositoryContextRetrievalConfig {
  maxTurns?: number;
  ttlMs?: number;
}

/**
 * Outbound adapter implementing ContextRetrievalPort backed by ChatRepositoryPort.
 * Retrieves recent dialogue turns, optionally filters by TTL, flattens turns into Message[],
 * and degrades gracefully with an empty array if the repository throws.
 */
export class ChatRepositoryContextRetrievalAdapter implements ContextRetrievalPort {
  private readonly maxTurns: number;
  private readonly ttlMs?: number;

  constructor(
    private chatRepository: ChatRepositoryPort,
    private logger: LoggerPort,
    config?: ChatRepositoryContextRetrievalConfig
  ) {
    this.maxTurns = config?.maxTurns ?? 10;
    this.ttlMs = config?.ttlMs;
  }

  async retrieveContext(userId: string): Promise<Message[]> {
    try {
      const turns = await this.chatRepository.getRecentTurns(userId, this.maxTurns);
      if (this.ttlMs !== undefined) {
        const cutoffTime = Date.now() - this.ttlMs;
        const freshTurns = turns.filter((turn) => turn.completedAt.getTime() >= cutoffTime);
        return freshTurns.flatMap((turn) => turn.messages);
      }
      return turns.flatMap((turn) => turn.messages);
    } catch (error) {
      this.logger.warn(
        'Failed to load conversation history from database, proceeding with empty context',
        error,
        { userId }
      );
      return [];
    }
  }
}
