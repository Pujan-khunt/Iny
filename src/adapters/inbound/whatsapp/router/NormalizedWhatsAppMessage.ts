import type { WAMessage } from "@whiskeysockets/baileys";

export type WhatsAppChatType = "direct" | "group" | "broadcast";

export type WhatsAppContentType = "text" | "image" | "document" | "unsupported";

export type WhatsAppUpsertType = "notify" | "append";

/**
 * Ingestion payload representing a raw Baileys messages.upsert event batch.
 */
export interface WhatsAppUpsertPayload {
	readonly type: WhatsAppUpsertType;
	readonly messages: readonly WAMessage[];
}

/**
 * Resolved sender identity and companion LID classification.
 */
export interface ResolvedWhatsAppIdentity {
	readonly senderJid: string;
	readonly senderType: "pn" | "lid";
	readonly companionLidJid: string | null;
}

/** Transport envelope retaining original provenance and the DM compatibility timestamp. */
export interface NormalizedWhatsAppMessage {
	/** Unique stanza message identifier (e.g. wamid or Baileys ID). */
	readonly messageId: string;
	/**
	 * Stanza target conversation container JID:
	 * - In direct chats: remote user JID (@s.whatsapp.net or @lid).
	 * - In group chats: group JID (@g.us).
	 * - In broadcasts: broadcast JID (@broadcast).
	 */
	readonly chatJid: string;
	/** Broad classification of the conversation container. */
	readonly chatType: WhatsAppChatType;
	/**
	 * Message author JID:
	 * - In direct chats: identical to chatJid.
	 * - In group chats: the individual participant who posted the message.
	 */
	readonly senderJid: string;
	/** Sender identity format classification. */
	readonly senderType: "pn" | "lid";
	/** Optional companion LID JID for direct chats (when remoteJidAlt is available). */
	readonly companionLidJid: string | null;
	/** True if the message was authored by the connected bot identity. */
	readonly fromMe: boolean;
	/** Actual transport delivery mode, retained independently of handler routing. */
	readonly upsertType: WhatsAppUpsertType;
	/** Valid source creation epoch milliseconds, or null if missing or invalid. */
	readonly originalTimestamp: number | null;
	/** Message creation epoch milliseconds, falling back to current time for DMs. */
	readonly timestamp: number;
	/** Extracted content payload metadata. */
	readonly content: {
		readonly type: WhatsAppContentType;
		readonly text: string | null;
		readonly mimeType: string | null;
	};
	/**
	 * Lazy media download closure.
	 * Defers binary buffer fetching until explicitly invoked by a handler that requires raw media.
	 * Resolves to Buffer if media exists and download succeeds, or null if unsupported/failed.
	 */
	readonly downloadMedia: () => Promise<Buffer | null>;
}

/** Routes matching normalized messages through the handler's declared delivery modes. */
export interface WhatsAppMessageHandler {
	readonly name: string;
	/**
	 * Accepted Baileys upsert event modes.
	 * Default: ["notify"] (real-time messages only).
	 * Handlers wanting historical replay (e.g. food announcements) explicitly declare ["notify", "append"].
	 */
	readonly acceptedUpsertTypes?: readonly WhatsAppUpsertType[];

	/**
	 * Evaluates whether this handler can process the given normalized message.
	 *
	 * @param message - The normalized WhatsApp message to evaluate.
	 * @returns True if this handler matches and should process the message.
	 */
	matches(message: NormalizedWhatsAppMessage): boolean;

	/**
	 * Processes the incoming normalized WhatsApp message.
	 *
	 * @param message - The normalized WhatsApp message to handle.
	 * @returns A promise resolving when message handling is complete.
	 */
	handle(message: NormalizedWhatsAppMessage): Promise<void>;
}
