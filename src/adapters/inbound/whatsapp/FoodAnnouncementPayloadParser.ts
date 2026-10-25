import { normalizeMessageContent, WAMessage } from "@whiskeysockets/baileys";
import { WhatsAppJid } from "../../common/whatsapp/WhatsAppJid";
import { LoggerPort } from "../../../core/ports/LoggerPort";

export interface ParsedFoodAnnouncementPayload {
	messageId: string;
	senderAddress: string;
	senderAddressType: "pn" | "lid";
	messageType: "image" | "document" | "text";
	mediaMimeType: string | null;
	textBody: string | null;
}

type UnwrappedContent = NonNullable<ReturnType<typeof normalizeMessageContent>>;

/**
 * Extracts, normalizes, and filters incoming WhatsApp food announcement messages.
 */
export class FoodAnnouncementPayloadParser {
	constructor(private readonly logger?: LoggerPort) {}

	/**
	 * Parses a raw WAMessage and returns normalized announcement payload if eligible.
	 */
	parse(msg: WAMessage, targetGroupJid: string): ParsedFoodAnnouncementPayload | null {
		if (!this.isTargetMessage(msg, targetGroupJid)) {
			return null;
		}

		const sender = this.resolveSender(msg);
		if (!sender) {
			this.logger?.debug("Ignored food announcement message missing participant", {
				messageId: msg.key.id,
			});
			return null;
		}

		const unwrapped = normalizeMessageContent(msg.message);
		if (!unwrapped) {
			this.logger?.debug("normalizeMessageContent returned empty for message", {
				messageId: msg.key.id,
			});
			return null;
		}

		const parsedType = this.resolveContentType(unwrapped);
		if (!parsedType) {
			this.logger?.debug("Ignored unsupported message type in food announcements group", {
				messageId: msg.key.id,
			});
			return null;
		}

		return {
			messageId: msg.key.id as string,
			senderAddress: sender.address,
			senderAddressType: sender.type,
			...parsedType,
		};
	}

	private isTargetMessage(msg: WAMessage | null | undefined, targetGroupJid: string): boolean {
		if (!msg?.key) {
			this.logger?.debug("Ignored malformed WAMessage missing key envelope");
			return false;
		}
		const { id, remoteJid, fromMe } = msg.key;
		if (remoteJid !== targetGroupJid || fromMe === true || !id) {
			this.logger?.debug("Ignored non-matching group or bot message", {
				messageId: id,
				remoteJid,
				fromMe,
			});
			return false;
		}
		return true;
	}

	private resolveSender(msg: WAMessage): { address: string; type: "pn" | "lid" } | null {
		const rawParticipant = msg.key.participant ?? msg.participant;
		if (!rawParticipant) {
			return null;
		}
		const normalized = WhatsAppJid.normalize(rawParticipant);
		const address = normalized ?? String(rawParticipant).trim().toLowerCase();
		const type: "pn" | "lid" = WhatsAppJid.isLidUser(address) ? "lid" : "pn";
		return { address, type };
	}

	private resolveMediaContent(unwrapped: UnwrappedContent): {
		messageType: "image" | "document";
		mediaMimeType: string | null;
		textBody: string | null;
	} | null {
		if (unwrapped.imageMessage) {
			return {
				messageType: "image",
				mediaMimeType: unwrapped.imageMessage.mimetype ?? "image/jpeg",
				textBody: unwrapped.imageMessage.caption ?? null,
			};
		}
		if (unwrapped.documentMessage) {
			return {
				messageType: "document",
				mediaMimeType: unwrapped.documentMessage.mimetype ?? "application/pdf",
				textBody: unwrapped.documentMessage.caption ?? unwrapped.documentMessage.fileName ?? null,
			};
		}
		return null;
	}

	private resolveTextContent(unwrapped: UnwrappedContent): {
		messageType: "text";
		mediaMimeType: null;
		textBody: string | null;
	} | null {
		if (unwrapped.conversation !== undefined && unwrapped.conversation !== null) {
			return {
				messageType: "text",
				mediaMimeType: null,
				textBody: unwrapped.conversation,
			};
		}
		const extendedText = unwrapped.extendedTextMessage?.text;
		if (extendedText !== undefined && extendedText !== null) {
			return {
				messageType: "text",
				mediaMimeType: null,
				textBody: extendedText,
			};
		}
		return null;
	}

	private resolveContentType(unwrapped: UnwrappedContent): {
		messageType: "image" | "document" | "text";
		mediaMimeType: string | null;
		textBody: string | null;
	} | null {
		return this.resolveMediaContent(unwrapped) ?? this.resolveTextContent(unwrapped);
	}
}
