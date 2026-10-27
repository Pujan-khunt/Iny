import type { WAMessage } from "@whiskeysockets/baileys";
import { LoggerPort } from "../../../../core/ports/LoggerPort";
import {
	NormalizedWhatsAppMessage,
	WhatsAppMessageHandler,
	WhatsAppUpsertPayload,
	WhatsAppUpsertType,
} from "./NormalizedWhatsAppMessage";
import { WhatsAppMessageNormalizer } from "./WhatsAppMessageNormalizer";

/**
 * Dispatches normalized WhatsApp messages to the first matching registered handler in order.
 */
export class WhatsAppMessageRouter {
	private readonly handlers: WhatsAppMessageHandler[] = [];

	/**
	 * Creates a new WhatsAppMessageRouter instance.
	 *
	 * @param normalizer - Inbound message normalizer collaborator.
	 * @param logger - Port for leveled structured logging.
	 */
	constructor(
		private readonly normalizer: WhatsAppMessageNormalizer,
		private readonly logger: LoggerPort,
	) {}

	/**
	 * Registers a message handler at the end of the evaluation chain.
	 *
	 * @param handler - The message handler implementation to register.
	 * @returns The router instance for fluent registration chaining.
	 */
	register(handler: WhatsAppMessageHandler): this {
		this.handlers.push(handler);
		return this;
	}

	/**
	 * Dispatches an upsert batch of raw Baileys messages.
	 */
	async handleUpsert(upsert: WhatsAppUpsertPayload): Promise<void> {
		for (const raw of upsert.messages) {
			await this.dispatchMessage(raw, upsert.type);
		}
	}

	private async dispatchMessage(raw: WAMessage, upsertType: WhatsAppUpsertType): Promise<void> {
		const normalized = this.normalizer.normalize(raw);
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
