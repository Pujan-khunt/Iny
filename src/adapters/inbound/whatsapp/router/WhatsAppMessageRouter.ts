import type { WAMessage } from "@whiskeysockets/baileys";
import { LoggerPort } from "../../../../core/ports/LoggerPort";
import {
	NormalizedWhatsAppMessage,
	WhatsAppMessageHandler,
	WhatsAppUpsertPayload,
	WhatsAppUpsertType,
} from "./NormalizedWhatsAppMessage";
import { WhatsAppMessageNormalizer } from "./WhatsAppMessageNormalizer";

const DEDUPLICATION_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_SIZE = 2000;

/**
 * Dispatches normalized WhatsApp messages to the first matching registered handler in order.
 */
export class WhatsAppMessageRouter {
	private readonly handlers: WhatsAppMessageHandler[] = [];
	private readonly inFlightMessageIds = new Set<string>();
	private readonly processedMessageIds = new Map<string, number>();

	constructor(
		private readonly normalizer: WhatsAppMessageNormalizer,
		private readonly logger: LoggerPort,
	) {}

	/** Registers a message handler at the end of the evaluation chain. */
	register(handler: WhatsAppMessageHandler): this {
		this.handlers.push(handler);
		return this;
	}

	/** Dispatches an upsert batch of raw Baileys messages. */
	async handleUpsert(upsert: WhatsAppUpsertPayload): Promise<void> {
		for (const raw of upsert.messages) {
			await this.dispatchMessage(raw, upsert.type);
		}
	}

	private isDuplicate(messageId: string): boolean {
		if (this.inFlightMessageIds.has(messageId)) {
			this.logger.debug("Dropping duplicate incoming WhatsApp stanza", {
				messageId,
				inFlight: true,
			});
			return true;
		}

		const processedAt = this.processedMessageIds.get(messageId);
		if (processedAt && Date.now() - processedAt < DEDUPLICATION_TTL_MS) {
			this.logger.debug("Dropping duplicate incoming WhatsApp stanza", {
				messageId,
				inFlight: false,
			});
			return true;
		}

		return false;
	}

	private recordProcessed(messageId: string): void {
		const now = Date.now();
		this.processedMessageIds.set(messageId, now);
		if (this.processedMessageIds.size > MAX_CACHE_SIZE) {
			for (const [id, timestamp] of this.processedMessageIds) {
				if (now - timestamp >= DEDUPLICATION_TTL_MS) {
					this.processedMessageIds.delete(id);
				}
			}
		}
	}

	private async dispatchMessage(raw: WAMessage, upsertType: WhatsAppUpsertType): Promise<void> {
		const messageId = raw.key?.id;
		if (messageId && this.isDuplicate(messageId)) {
			return;
		}

		if (messageId) {
			this.inFlightMessageIds.add(messageId);
		}

		try {
			await this.processMessage(raw, upsertType);
		} finally {
			if (messageId) {
				this.inFlightMessageIds.delete(messageId);
				this.recordProcessed(messageId);
			}
		}
	}

	private async processMessage(raw: WAMessage, upsertType: WhatsAppUpsertType): Promise<void> {
		const normalized = this.normalizer.normalize(raw, upsertType);
		if (!normalized) {
			return;
		}

		for (const handler of this.handlers) {
			const acceptedTypes = handler.acceptedUpsertTypes ?? ["notify"];
			if (!acceptedTypes.includes(upsertType)) {
				continue;
			}

			let isMatch = false;
			try {
				isMatch = handler.matches(normalized);
			} catch (error) {
				this.logger.warn("Handler match predicate threw unexpected error", error, {
					handler: handler.name,
					messageId: normalized.messageId,
				});
			}

			if (isMatch) {
				await this.executeHandler(handler, normalized);
				break;
			}
		}
	}

	private async executeHandler(
		handler: WhatsAppMessageHandler,
		normalized: NormalizedWhatsAppMessage,
	): Promise<void> {
		this.logger.info("Routed incoming message to handler", {
			messageId: normalized.messageId,
			handler: handler.name,
			chatType: normalized.chatType,
		});

		const startTime = Date.now();
		try {
			await handler.handle(normalized);
			const durationMs = Date.now() - startTime;
			this.logger.debug("Handler completed message processing", {
				handler: handler.name,
				messageId: normalized.messageId,
				durationMs,
			});
		} catch (error) {
			this.logger.error("Handler failed during message processing", error, {
				handler: handler.name,
				messageId: normalized.messageId,
			});
		}
	}
}
