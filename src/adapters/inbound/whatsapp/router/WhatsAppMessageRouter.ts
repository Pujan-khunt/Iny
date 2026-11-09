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
		const inFlight = this.inFlightMessageIds.has(messageId);
		const processedAt = this.processedMessageIds.get(messageId);
		const isCompleted = Boolean(processedAt && Date.now() - processedAt < DEDUPLICATION_TTL_MS);
		if (inFlight || isCompleted) {
			this.logger.debug("Dropping duplicate incoming WhatsApp stanza", {
				messageId,
				inFlight,
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
				if (now - timestamp >= DEDUPLICATION_TTL_MS) this.processedMessageIds.delete(id);
			}
			while (this.processedMessageIds.size > MAX_CACHE_SIZE) {
				const oldestKey = this.processedMessageIds.keys().next().value;
				if (!oldestKey) break;
				this.processedMessageIds.delete(oldestKey);
			}
		}
	}

	private async dispatchMessage(raw: WAMessage, upsertType: WhatsAppUpsertType): Promise<void> {
		if (raw.key?.fromMe) {
			this.logger.debug("Dropping outgoing/self WhatsApp stanza", {
				messageId: raw.key?.id,
			});
			return;
		}

		const messageId = raw.key?.id;
		if (messageId && this.isDuplicate(messageId)) return;
		if (messageId) this.inFlightMessageIds.add(messageId);

		let success = false;
		try {
			success = await this.processMessage(raw, upsertType);
		} finally {
			if (messageId) {
				this.inFlightMessageIds.delete(messageId);
				if (success) this.recordProcessed(messageId);
			}
		}
	}

	private async processMessage(raw: WAMessage, upsertType: WhatsAppUpsertType): Promise<boolean> {
		const normalized = this.normalizer.normalize(raw, upsertType);
		if (!normalized) return true;

		for (const handler of this.handlers) {
			const acceptedTypes = handler.acceptedUpsertTypes ?? ["notify"];
			if (!acceptedTypes.includes(upsertType)) continue;

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
				return await this.executeHandler(handler, normalized);
			}
		}
		return true;
	}

	private async executeHandler(
		handler: WhatsAppMessageHandler,
		normalized: NormalizedWhatsAppMessage,
	): Promise<boolean> {
		this.logger.info("Routed incoming message to handler", {
			messageId: normalized.messageId,
			handler: handler.name,
			chatType: normalized.chatType,
			contentType: normalized.content.type,
			contentPreview: normalized.content.preview,
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
			return true;
		} catch (error) {
			this.logger.error("Handler failed during message processing", error, {
				handler: handler.name,
				messageId: normalized.messageId,
			});
			return false;
		}
	}
}
