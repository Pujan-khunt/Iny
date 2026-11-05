import { toNumber, WAMessage } from "@whiskeysockets/baileys";
import { LoggerPort } from "../../../../core/ports/LoggerPort";
import { WhatsAppJid } from "../../../common/whatsapp/WhatsAppJid";
import {
	NormalizedWhatsAppMessage,
	ResolvedWhatsAppIdentity,
	WhatsAppChatType,
	WhatsAppUpsertType,
} from "./NormalizedWhatsAppMessage";
import { WhatsAppMessageContentExtractor } from "./WhatsAppMessageContentExtractor";

/**
 * Normalizes raw Baileys WAMessage stanzas into uniform NormalizedWhatsAppMessage instances.
 * Extracts sender and conversation metadata, standardizes JIDs, and constructs lazy media downloaders.
 */
export class WhatsAppMessageNormalizer {
	/**
	 * Creates a new WhatsAppMessageNormalizer instance.
	 *
	 * @param logger - Port for logging diagnostic and error events.
	 * @param contentExtractor - Inbound message content extractor collaborator.
	 */
	constructor(
		private readonly logger: LoggerPort,
		private readonly contentExtractor: WhatsAppMessageContentExtractor,
	) {}

	/**
	 * Normalizes a raw Baileys message into a clean, uniform domain representation.
	 *
	 * @param raw - The incoming raw Baileys WAMessage stanza.
	 * @param upsertType - Actual delivery mode from the transport event.
	 * @returns The normalized message, or null if key or chat metadata is missing or invalid.
	 */
	normalize(raw: WAMessage, upsertType: WhatsAppUpsertType): NormalizedWhatsAppMessage | null {
		if (!raw?.key?.id || !raw.key.remoteJid) {
			this.logger.debug("Ignored malformed raw message missing key or id", {
				messageId: raw?.key?.id,
				reason: "missing_key_or_id",
			});
			return null;
		}

		const chatJid = raw.key.remoteJid.trim().toLowerCase();
		const chatType = this.resolveChatType(chatJid);
		const identity = this.resolveIdentity(raw, chatJid, chatType);
		const content = this.contentExtractor.extractContent(raw);
		const originalTimestamp = this.resolveTimestamp(raw.messageTimestamp);

		const normalized: NormalizedWhatsAppMessage = {
			messageId: raw.key.id,
			chatJid,
			chatType,
			senderJid: identity.senderJid,
			senderType: identity.senderType,
			companionLidJid: identity.companionLidJid,
			fromMe: Boolean(raw.key.fromMe),
			upsertType,
			originalTimestamp,
			timestamp: originalTimestamp ?? Date.now(),
			content,
			downloadMedia: this.contentExtractor.buildLazyMediaClosure(raw, content.type),
		};

		this.logger.debug("Normalized incoming WhatsApp message", {
			messageId: normalized.messageId,
			chatJid: normalized.chatJid,
			chatType: normalized.chatType,
		});

		return normalized;
	}

	/**
	 * Classifies the conversation container type based on the destination JID format.
	 *
	 * @param chatJid - The normalized conversation container JID.
	 * @returns The classified chat container type ("group" | "broadcast" | "direct").
	 */
	private resolveChatType(chatJid: string): WhatsAppChatType {
		if (WhatsAppJid.isGroup(chatJid)) return "group";
		return WhatsAppJid.isBroadcast(chatJid) ? "broadcast" : "direct";
	}

	/**
	 * Resolves message author identity, classification, and companion LID for caching.
	 * Supports bidirectional PN/LID discovery in direct chats.
	 *
	 * @param raw - The incoming raw Baileys WAMessage stanza.
	 * @param chatJid - The normalized conversation container JID.
	 * @param chatType - The classified conversation container type.
	 * @returns The resolved sender identity and companion LID.
	 */
	private resolveIdentity(
		raw: WAMessage,
		chatJid: string,
		chatType: WhatsAppChatType,
	): ResolvedWhatsAppIdentity {
		return chatType === "group"
			? this.resolveGroupIdentity(raw, chatJid)
			: this.resolveDirectIdentity(raw, chatJid);
	}

	private resolveGroupIdentity(raw: WAMessage, chatJid: string): ResolvedWhatsAppIdentity {
		const target = raw.key.participant ?? raw.participant ?? chatJid;
		const senderJid = WhatsAppJid.normalize(target) ?? target.trim().toLowerCase();
		const senderType = WhatsAppJid.isLidUser(senderJid) ? "lid" : "pn";
		return { senderJid, senderType, companionLidJid: null };
	}

	private resolveDirectIdentity(raw: WAMessage, chatJid: string): ResolvedWhatsAppIdentity {
		if (raw.key.remoteJidAlt) {
			const alt =
				WhatsAppJid.normalize(raw.key.remoteJidAlt) ?? raw.key.remoteJidAlt.trim().toLowerCase();
			if (WhatsAppJid.isLidUser(chatJid) && WhatsAppJid.isPnUser(alt)) {
				return {
					senderJid: alt,
					senderType: "pn",
					companionLidJid: WhatsAppJid.normalize(chatJid),
				};
			}
			if (WhatsAppJid.isLidUser(alt)) {
				const senderJid = WhatsAppJid.normalize(chatJid) ?? chatJid;
				return { senderJid, senderType: "pn", companionLidJid: alt };
			}
		}

		const senderJid = WhatsAppJid.normalize(chatJid) ?? chatJid;
		const senderType = WhatsAppJid.isLidUser(senderJid) ? "lid" : "pn";
		return { senderJid, senderType, companionLidJid: null };
	}

	/**
	 * Resolves the message epoch timestamp in milliseconds from raw Baileys seconds.
	 *
	 * @param rawTimestamp - Raw Baileys message timestamp (Protobuf Long, number, or null).
	 * @returns Source epoch milliseconds, or null when missing, invalid, or outside the Date range.
	 */
	private resolveTimestamp(rawTimestamp: WAMessage["messageTimestamp"]): number | null {
		const seconds = toNumber(rawTimestamp);
		const milliseconds = seconds * 1000;
		return Number.isFinite(seconds) && seconds > 0 && milliseconds <= 8640000000000000
			? milliseconds
			: null;
	}
}
