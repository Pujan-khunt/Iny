import { LoggerPort } from "../../../../core/ports/LoggerPort";
import {
	NormalizedWhatsAppMessage,
	WhatsAppMessageHandler,
	WhatsAppUpsertType,
} from "./NormalizedWhatsAppMessage";

/**
 * Terminal fallback handler registered at the end of the priority chain.
 * Matches any unhandled incoming message and logs structured debug metadata.
 */
export class CatchAllLoggingHandler implements WhatsAppMessageHandler {
	readonly name = "catch-all-logging";
	readonly acceptedUpsertTypes: readonly WhatsAppUpsertType[] = ["notify", "append"] as const;

	constructor(private readonly logger: LoggerPort) {}

	matches(_message: NormalizedWhatsAppMessage): boolean {
		return true;
	}

	async handle(message: NormalizedWhatsAppMessage): Promise<void> {
		this.logger.debug("Unhandled incoming message ignored by catch-all fallback", {
			messageId: message.messageId,
			chatJid: message.chatJid,
			senderJid: message.senderJid,
			chatType: message.chatType,
			contentType: message.content.type,
		});
	}
}
