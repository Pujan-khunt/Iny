import { Message, UserMessage } from '../entities/Message';
import { DialogueTurn } from '../entities/DialogueTurn';
import { MessageSenderPort } from '../ports/MessageSenderPort';
import { ChatRepositoryPort } from '../ports/ChatRepositoryPort';
import { ToolRegistryPort } from '../ports/ToolRegistryPort';
import { LoggerPort } from '../ports/LoggerPort';
import { AgentLoop, AgentLoopResult } from './AgentLoop';
import {
  LLMError,
  LLMAuthenticationError,
  LLMInsufficientBalanceError,
  LLMRateLimitError,
  LLMServerOverloadedError,
} from '../errors/LLMErrors';

export interface ProcessIncomingMessageConfig {
  maxHistoryTurns?: number;
}

export class ProcessIncomingMessage {
  private readonly maxHistoryTurns: number;

  constructor(
    private sender: MessageSenderPort,
    private chatRepository: ChatRepositoryPort,
    private agentLoop: AgentLoop,
    private toolRegistry: ToolRegistryPort,
    private logger: LoggerPort,
    config?: ProcessIncomingMessageConfig
  ) {
    this.maxHistoryTurns = config?.maxHistoryTurns ?? 10;
  }

  async execute(message: UserMessage): Promise<void> {
    const log = this.logger.child({ userId: message.userId, messageId: message.id });
    log.info('Processing incoming message');

    // 1. REASONING PHASE
    let loopResult: AgentLoopResult;
    try {
      const history = await this.loadHistoricalMessages(message.userId);
      const tools = this.toolRegistry.getToolDefinitions();
      loopResult = await this.agentLoop.run(message, history, tools, log);
    } catch (reasoningError) {
      this.handleReasoningError(reasoningError, log);
      await this.safeSendFallback(message.userId, reasoningError, log);
      return;
    }

    // 2. DELIVERY PHASE
    try {
      await this.sender.sendMessage(message.userId, loopResult.finalText);
    } catch (deliveryError) {
      log.error('Failed to deliver message to user via transport', deliveryError);
      // Transport failed: do not attempt to send error notification through the dead transport.
      return;
    }

    // 3. PERSISTENCE PHASE
    try {
      const turn: DialogueTurn = {
        id: crypto.randomUUID(),
        userId: message.userId,
        messages: loopResult.sessionMessages,
        createdAt: new Date(),
      };
      await this.chatRepository.saveTurn(turn);
      log.info('Message processed successfully');
    } catch (persistenceError) {
      log.error('Failed to persist dialogue turn', persistenceError);
      // User already received their message, so do not crash or message user.
    }
  }

  private async loadHistoricalMessages(userId: string): Promise<Message[]> {
    const recentTurns = await this.chatRepository.getRecentTurns(userId, this.maxHistoryTurns);
    return recentTurns.flatMap((turn) => turn.messages);
  }

  private handleReasoningError(error: unknown, log: LoggerPort): void {
    if (error instanceof LLMAuthenticationError || error instanceof LLMInsufficientBalanceError) {
      log.fatal('Unrecoverable LLM account or authentication failure', error, {
        status: error.status,
        code: error.code,
      });
    } else {
      log.error('Failed during reasoning loop', error, {
        status: error instanceof LLMError ? error.status : undefined,
        code: error instanceof LLMError ? error.code : undefined,
      });
    }
  }

  private async safeSendFallback(userId: string, error: unknown, log: LoggerPort): Promise<void> {
    try {
      const userMessage =
        error instanceof LLMRateLimitError || error instanceof LLMServerOverloadedError
          ? 'Iny is experiencing heavy traffic right now. Please try again in a moment.'
          : 'An error occurred during processing.';
      await this.sender.sendMessage(userId, userMessage);
    } catch (fallbackError) {
      log.error('Failed to send error notification to user', fallbackError);
    }
  }
}
