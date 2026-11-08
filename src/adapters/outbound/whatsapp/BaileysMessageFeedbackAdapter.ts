import { MessageFeedbackPort } from "../../../core/ports/MessageFeedbackPort";
import { LoggerPort } from "../../../core/ports/LoggerPort";
import { BaileysConnectionManager } from "./BaileysConnectionManager";

/**
 * Outbound transport adapter implementing MessageFeedbackPort to deliver
 * interactive conversational feedback over the active WhatsApp socket connection.
 */
export class BaileysMessageFeedbackAdapter implements MessageFeedbackPort {
	constructor(
		private readonly connectionManager: BaileysConnectionManager,
		private readonly logger: LoggerPort,
	) {}

	async sendReadReceipt(userId: string, messageId: string): Promise<void> {
		const socket = this.connectionManager.getSocket();
		if (!socket) {
			throw new Error("WhatsApp socket is not connected");
		}

		try {
			await socket.readMessages([{ remoteJid: userId, id: messageId }]);
		} catch (err) {
			this.logger.error("Failed to send WhatsApp read receipt", err, {
				recipientPnJid: userId,
				messageId,
			});
			throw err;
		}
	}

	async sendTypingIndicator(userId: string, presence: "composing" | "paused"): Promise<void> {
		const socket = this.connectionManager.getSocket();
		if (!socket) {
			throw new Error("WhatsApp socket is not connected");
		}

		try {
			await socket.sendPresenceUpdate(presence, userId);
		} catch (err) {
			this.logger.error("Failed to send WhatsApp presence update", err, {
				recipientPnJid: userId,
				presence,
			});
			throw err;
		}
	}

	async sendReaction(userId: string, messageId: string, reaction: string): Promise<void> {
		const socket = this.connectionManager.getSocket();
		if (!socket) {
			throw new Error("WhatsApp socket is not connected");
		}

		try {
			await socket.sendMessage(userId, {
				react: {
					text: reaction,
					key: { remoteJid: userId, id: messageId },
				},
			});
		} catch (err) {
			this.logger.error("Failed to send WhatsApp reaction", err, {
				recipientPnJid: userId,
				messageId,
				reaction,
			});
			throw err;
		}
	}
}
