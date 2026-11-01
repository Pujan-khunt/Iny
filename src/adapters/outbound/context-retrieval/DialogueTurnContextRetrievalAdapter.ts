import { ContextRetrievalPort } from "../../../core/ports/ContextRetrievalPort";
import { DialogueTurnRepositoryPort } from "../../../core/ports/DialogueTurnRepositoryPort";
import { LoggerPort } from "../../../core/ports/LoggerPort";
import { Message, UserMessage, AssistantTextMessage } from "../../../core/entities/Message";

export interface DialogueTurnContextRetrievalConfig {
	maxTurns?: number;
	ttlMs?: number;
}

const isConversationalMessage = (msg: Message): msg is UserMessage | AssistantTextMessage =>
	msg.role === "user" || (msg.role === "assistant" && msg.toolCalls === undefined);

/**
 * Outbound adapter implementing ContextRetrievalPort backed by DialogueTurnRepositoryPort.
 * Retrieves recent dialogue turns, optionally filters by TTL, flattens turns into Message[],
 * and degrades gracefully with an empty array if the repository throws.
 */
export class DialogueTurnContextRetrievalAdapter implements ContextRetrievalPort {
	private readonly maxTurns: number;
	private readonly ttlMs?: number;

	constructor(
		private turnRepository: DialogueTurnRepositoryPort,
		private logger: LoggerPort,
		config?: DialogueTurnContextRetrievalConfig,
	) {
		this.maxTurns = config?.maxTurns ?? 10;
		this.ttlMs = config?.ttlMs;
	}

	async retrieveContext(userId: string): Promise<Message[]> {
		try {
			const turns = await this.turnRepository.getRecentTurns(userId, this.maxTurns);
			const cutoffTime = this.ttlMs !== undefined ? Date.now() - this.ttlMs : undefined;
			const rawTurns =
				cutoffTime !== undefined
					? turns.filter((turn) => turn.completedAt.getTime() >= cutoffTime)
					: turns;
			return rawTurns.flatMap((turn) => turn.messages.filter(isConversationalMessage));
		} catch (error) {
			this.logger.warn(
				"Failed to load conversation history from database, proceeding with empty context",
				error,
				{ userId },
			);
			return [];
		}
	}
}
