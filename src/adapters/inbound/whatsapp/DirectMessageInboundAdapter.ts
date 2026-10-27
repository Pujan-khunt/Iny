import { MessageFactory } from "../../../core/entities/Message";
import { AccessControlPort } from "../../../core/ports/AccessControlPort";
import { LoggerPort } from "../../../core/ports/LoggerPort";
import { HandleIncomingUserMessage } from "../../../core/use-cases/HandleIncomingUserMessage";
import {
	NormalizedWhatsAppMessage,
	WhatsAppMessageHandler,
	WhatsAppUpsertType,
} from "./router/NormalizedWhatsAppMessage";

/**
 * Driving inbound adapter that matches direct 1-on-1 text messages from WhatsApp users,
 * verifies access control authorization, maps them into domain UserMessage entities,
 * and triggers HandleIncomingUserMessage.
 */
export class DirectMessageInboundAdapter implements WhatsAppMessageHandler {
	readonly name = "direct-message";
	readonly acceptedUpsertTypes: readonly WhatsAppUpsertType[] = ["notify"] as const;

	constructor(
		private readonly useCase: HandleIncomingUserMessage,
		private readonly accessControl: AccessControlPort,
		private readonly logger: LoggerPort,
	) {}

	matches(message: NormalizedWhatsAppMessage): boolean {
		return Boolean(
			!message.fromMe &&
			message.chatType === "direct" &&
			message.content.type === "text" &&
			message.content.text &&
			message.content.text.trim().length > 0,
		);
	}

	async handle(message: NormalizedWhatsAppMessage): Promise<void> {
		const user = await this.accessControl.authenticate(message.senderJid, message.companionLidJid);

		if (!user) {
			this.logger.debug("Ignored message from unauthorized or inactive sender", {
				senderJid: message.senderJid,
				companionLidJid: message.companionLidJid,
			});
			return;
		}

		const userMessage = MessageFactory.createUser({
			id: message.messageId,
			userId: user.pnJid,
			content: message.content.text ?? "",
			timestamp: new Date(message.timestamp),
		});

		await this.useCase.execute(userMessage);
	}
}
