import { UserMessage } from '../entities/Message';
import { DialogueTurnFactory } from '../entities/DialogueTurn';
import { MessageSenderPort } from '../ports/MessageSenderPort';
import { ChatRepositoryPort } from '../ports/ChatRepositoryPort';
import { ContextRetrievalPort } from '../ports/ContextRetrievalPort';
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

/**
 * Orchestrating use case that processes incoming user messages.
 * Coordinates conversation context retrieval, agent reasoning loop execution,
 * transport delivery, and dialogue turn persistence.
 */
export class ProcessIncomingMessage {
  /**
   * Initializes the use case with its required ports and collaborators.
   *
   * @param sender Transport port used to transmit outbound text responses.
   * @param chatRepository Persistence port used to store completed dialogue turns.
   * @param contextRetrieval Port used to retrieve historical context messages for the user.
   * @param agentLoop Domain service executing the ReAct agent reasoning loop.
   * @param toolRegistry Registry providing active tool definitions to the LLM.
   * @param logger Leveled structured logger port.
   */
  constructor(
    private sender: MessageSenderPort,
    private chatRepository: ChatRepositoryPort,
    private contextRetrieval: ContextRetrievalPort,
    private agentLoop: AgentLoop,
    private toolRegistry: ToolRegistryPort,
    private logger: LoggerPort
  ) {}

  /**
   * Executes the end-to-end processing pipeline for an incoming user message:
   * 1. Context Retrieval: Loads historical messages via ContextRetrievalPort.
   * 2. Reasoning: Runs the autonomous AgentLoop with active tools.
   * 3. Delivery: Dispatches the assistant's final response via MessageSenderPort.
   * 4. Persistence: Saves the completed dialogue turn to ChatRepositoryPort.
   *
   * @param message The verified inbound user message.
   */
  async execute(message: UserMessage): Promise<void> {
    const startedAt = new Date();
    const log = this.logger.child({ userId: message.userId, messageId: message.id });
    log.info('Processing incoming message');

    const history = await this.contextRetrieval.retrieveContext(message.userId);

    let loopResult: AgentLoopResult;
    try {
      const tools = this.toolRegistry.getToolDefinitions();
      loopResult = await this.agentLoop.run(message, history, tools, log);
    } catch (reasoningError) {
      this.handleReasoningError(reasoningError, log);
      await this.safeSendFallback(message.userId, reasoningError, log);
      return;
    }

    try {
      await this.sender.sendMessage(message.userId, loopResult.finalText);
    } catch (deliveryError) {
      log.error('Failed to deliver message to user via transport', deliveryError);
      return;
    }
    const completedAt = new Date();

    try {
      const turn = DialogueTurnFactory.create({
        userId: message.userId,
        messages: loopResult.sessionMessages,
        startedAt,
        completedAt,
      });
      await this.chatRepository.saveTurn(turn);
      log.info('Message processed successfully');
    } catch (persistenceError) {
      log.error('Failed to persist dialogue turn', persistenceError);
    }
  }

  /**
   * Categorizes and logs reasoning-phase errors with appropriate severity levels.
   * Logs fatal for unrecoverable authentication/balance failures, and error for general LLM failures.
   *
   * @param error The error thrown during the reasoning loop.
   * @param log Contextual logger instance.
   */
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

  /**
   * Attempts to transmit a user-friendly error notification when the reasoning phase fails.
   * Suppresses secondary transport failures to avoid masking the primary error.
   *
   * @param userId Unique identifier of the user to notify.
   * @param error The original error that triggered fallback notification.
   * @param log Contextual logger instance.
   */
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
