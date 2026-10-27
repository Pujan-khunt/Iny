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
type AnnouncementContent = Pick<
	ParsedFoodAnnouncementPayload,
	"messageType" | "mediaMimeType" | "textBody"
>;

type TargetFoodAnnouncementMessage = WAMessage & {
	key: WAMessage["key"] & {
		id: string;
		remoteJid: string;
	};
};

/**
 * Extracts, normalizes, and filters incoming WhatsApp food announcement messages.
 */
export class FoodAnnouncementPayloadParser {
	constructor(private readonly logger: LoggerPort) {}

	/**
	 * Parses a raw WAMessage and returns normalized announcement payload if eligible.
	 */
	parse(msg: WAMessage, targetGroupJid: string): ParsedFoodAnnouncementPayload | null {
		if (!this.isTargetMessage(msg, targetGroupJid)) {
			return null;
		}

		const sender = this.resolveSender(msg);
		if (!sender) {
			this.logger.debug("Ignored food announcement message missing participant", {
				messageId: msg.key.id,
			});
			return null;
		}

		const unwrapped = normalizeMessageContent(msg.message);
		if (!unwrapped) {
			this.logger.debug("normalizeMessageContent returned empty for message", {
				messageId: msg.key.id,
			});
			return null;
		}

		const parsedType = this.resolveContentType(unwrapped);
		if (!parsedType) {
			this.logger.debug("Ignored unsupported message type in food announcements group", {
				messageId: msg.key.id,
			});
			return null;
		}

		return {
			messageId: msg.key.id,
			senderAddress: sender.address,
			senderAddressType: sender.type,
			...parsedType,
		};
	}

	private isTargetMessage(
		msg: WAMessage | null | undefined,
		targetGroupJid: string,
	): msg is TargetFoodAnnouncementMessage {
		if (!msg?.key) {
			this.logger.debug("Ignored malformed WAMessage missing key envelope");
			return false;
		}
		if (msg.key.remoteJid !== targetGroupJid) {
			this.logger.debug("Ignored message from non-target group", {
				messageId: msg.key.id,
				remoteJid: msg.key.remoteJid,
				targetGroupJid,
			});
			return false;
		}
		if (!msg.key.id) {
			this.logger.debug("Ignored food announcement message missing id", {
				remoteJid: msg.key.remoteJid,
			});
			return false;
		}
		if (msg.key.fromMe === true) {
			this.logger.debug("Ignored food announcement message sent from bot itself", {
				messageId: msg.key.id,
				remoteJid: msg.key.remoteJid,
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
		return { address, type: WhatsAppJid.isLidUser(address) ? "lid" : "pn" };
	}

	private resolveMediaContent(unwrapped: UnwrappedContent): AnnouncementContent | null {
		const img = unwrapped.imageMessage;
		if (img) {
			return {
				messageType: "image",
				mediaMimeType: img.mimetype ?? "image/jpeg",
				textBody: img.caption ?? null,
			};
		}
		const doc = unwrapped.documentMessage;
		if (doc) {
			return {
				messageType: "document",
				mediaMimeType: doc.mimetype ?? "application/pdf",
				textBody: doc.caption ?? doc.fileName ?? null,
			};
		}
		return null;
	}

	private resolveTextContent(unwrapped: UnwrappedContent): AnnouncementContent | null {
		const text = unwrapped.conversation ?? unwrapped.extendedTextMessage?.text;
		return text !== undefined && text !== null
			? { messageType: "text", mediaMimeType: null, textBody: text }
			: null;
	}

	private resolveContentType(unwrapped: UnwrappedContent): AnnouncementContent | null {
		return this.resolveMediaContent(unwrapped) ?? this.resolveTextContent(unwrapped);
	}
}
