import { UserMessage } from "../entities/Message";
import { DialogueTurn, DialogueTurnFactory } from "../entities/DialogueTurn";
import { MessageSenderPort } from "../ports/MessageSenderPort";
import { MessageFeedbackPort } from "../ports/MessageFeedbackPort";
import { DialogueTurnRepositoryPort } from "../ports/DialogueTurnRepositoryPort";
import { ContextRetrievalPort } from "../ports/ContextRetrievalPort";
import { ToolRegistryPort } from "../ports/ToolRegistryPort";
import { LoggerPort } from "../ports/LoggerPort";
import { AgentLoop, AgentLoopResult } from "../services/AgentLoop";
import {
	LLMError,
	LLMAuthenticationError,
	LLMInsufficientBalanceError,
	LLMRateLimitError,
	LLMServerOverloadedError,
} from "../errors/LLMErrors";

/**
 * Orchestrating use case coordinating context retrieval, interactive feedback,
 * agent reasoning loop execution, transport delivery, and turn persistence.
 */
export class HandleIncomingUserMessage {
	constructor(
		private readonly sender: MessageSenderPort,
		private readonly feedback: MessageFeedbackPort,
		private readonly dialogueTurnRepository: DialogueTurnRepositoryPort,
		private readonly contextRetrieval: ContextRetrievalPort,
		private readonly agentLoop: AgentLoop,
		private readonly toolRegistry: ToolRegistryPort,
		private readonly logger: LoggerPort,
	) {}

	/**
	 * Executes the end-to-end processing pipeline for an incoming user message.
	 *
	 * @param message The verified inbound user message.
	 * @returns Promise resolving once processing and dispatch complete.
	 */
	async execute(message: UserMessage): Promise<void> {
		const startedAt = new Date();
		const log = this.logger.child({ userId: message.userId, messageId: message.id });
		log.info("Processing incoming message");

		await this.safeInitialFeedback(message.userId, message.id, log);
		const history = await this.contextRetrieval.retrieveContext(message.userId);

		let loopResult: AgentLoopResult;
		try {
			const tools = this.toolRegistry.getToolDefinitions();
			loopResult = await this.agentLoop.run(message, history, tools, log);
		} catch (reasoningError) {
			this.handleReasoningError(reasoningError, log);
			await this.safeFinalFeedback(message.userId, message.id, log);
			await this.safeSendFallback(message.userId, reasoningError, log);
			return;
		}

		let completedAt: Date;
		try {
			await this.sender.sendMessage(message.userId, loopResult.finalText);
			completedAt = new Date();
		} catch (deliveryError) {
			log.error("Failed to deliver message to user via transport", deliveryError);
			throw deliveryError;
		} finally {
			await this.safeFinalFeedback(message.userId, message.id, log);
		}

		const turn = DialogueTurnFactory.create({
			userId: message.userId,
			messages: loopResult.sessionMessages,
			startedAt,
			completedAt,
		});
		await this.safeSaveTurn(turn, log);
	}

	private async safeSaveTurn(turn: DialogueTurn, log: LoggerPort): Promise<void> {
		try {
			await this.dialogueTurnRepository.saveTurn(turn);
			log.info("Message processed successfully");
		} catch (persistenceError) {
			log.error("Failed to persist dialogue turn", persistenceError);
		}
	}

	private handleReasoningError(error: unknown, log: LoggerPort): void {
		const isAuth =
			error instanceof LLMAuthenticationError || error instanceof LLMInsufficientBalanceError;
		const ctx = error instanceof LLMError ? { status: error.status, code: error.code } : undefined;
		if (isAuth) {
			log.fatal("Unrecoverable LLM account or authentication failure", error, ctx);
		} else {
			log.error("Failed during reasoning loop", error, ctx);
		}
	}

	private async safeSendFallback(userId: string, error: unknown, log: LoggerPort): Promise<void> {
		try {
			const text =
				error instanceof LLMRateLimitError || error instanceof LLMServerOverloadedError
					? "Iny is experiencing heavy traffic right now. Please try again in a moment."
					: "An error occurred during processing.";
			await this.sender.sendMessage(userId, text);
		} catch (fallbackError) {
			log.error("Failed to send error notification to user", fallbackError);
			throw fallbackError;
		}
	}

	private async safeInitialFeedback(
		userId: string,
		messageId: string,
		log: LoggerPort,
	): Promise<void> {
		const results = await Promise.allSettled([
			this.feedback.sendReadReceipt(userId, messageId),
			this.feedback.sendTypingIndicator(userId, "composing"),
			this.feedback.sendReaction(userId, messageId, "👀"),
		]);
		this.logSettledErrors(results, "Auxiliary initial message feedback failed", log);
	}

	private async safeFinalFeedback(
		userId: string,
		messageId: string,
		log: LoggerPort,
	): Promise<void> {
		const results = await Promise.allSettled([
			this.feedback.sendTypingIndicator(userId, "paused"),
			this.feedback.sendReaction(userId, messageId, ""),
		]);
		this.logSettledErrors(results, "Auxiliary final message feedback failed", log);
	}

	private logSettledErrors(
		results: PromiseSettledResult<void>[],
		message: string,
		log: LoggerPort,
	): void {
		for (const res of results) {
			if (res.status === "rejected") {
				log.info(message, {
					error: res.reason instanceof Error ? res.reason.message : String(res.reason),
				});
			}
		}
	}
}
