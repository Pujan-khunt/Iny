import { downloadMediaMessage, normalizeMessageContent, WAMessage } from "@whiskeysockets/baileys";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { whatsappGroupFoodAnnouncementsMessages } from "../../outbound/mess/postgres/schema.js";
import { WhatsAppJid } from "../../common/whatsapp/WhatsAppJid.js";
import { BaileysConnectionManager } from "../../outbound/whatsapp/BaileysConnectionManager.js";
import { LoggerPort } from "../../../core/ports/LoggerPort.js";

/**
 * Options required to initialize the FoodAnnouncementsInboundAdapter.
 */
export interface FoodAnnouncementsInboundAdapterOptions {
	/** The WhatsApp group JID for food announcements (e.g. from config.FOOD_ANNOUNCEMENTS_GROUP_JID). */
	targetGroupJid: string;
	/** Drizzle PostgreSQL database client. */
	db: PgDatabase<any, any, any>;
	/** Baileys connection manager to subscribe to inbound WhatsApp events. */
	connectionManager: BaileysConnectionManager;
	/** Leveled structured logger port. */
	logger?: LoggerPort;
	/** Optional custom media download function (defaults to Baileys downloadMediaMessage). */
	downloadMedia?: typeof downloadMediaMessage;
}

const noopLogger: LoggerPort = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	child: () => noopLogger,
};

/**
 * Inbound adapter that listens for broadcast messages from the official Food Announcements
 * WhatsApp group, normalizes sender and media content, downloads media attachments,
 * and idempotently inserts raw records into the staging table for manual or automated triage.
 *
 * Invariant: Never sends any reply message to the WhatsApp group.
 */
export class FoodAnnouncementsInboundAdapter {
	private readonly targetGroupJid: string;
	private readonly db: PgDatabase<any, any, any>;
	private readonly connectionManager: BaileysConnectionManager;
	private readonly logger: LoggerPort;
	private readonly downloadMedia: typeof downloadMediaMessage;

	constructor(options: FoodAnnouncementsInboundAdapterOptions) {
		this.targetGroupJid = options.targetGroupJid;
		this.db = options.db;
		this.connectionManager = options.connectionManager;
		this.logger = options.logger ?? noopLogger;
		this.downloadMedia = options.downloadMedia ?? downloadMediaMessage;
	}

	/**
	 * Subscribes to Baileys messages.upsert events.
	 */
	start(): void {
		this.connectionManager.subscribe("messages.upsert", async (upsert: any) => {
			this.logger.debug("Received messages.upsert event from Baileys", {
				type: upsert?.type,
				messageCount: Array.isArray(upsert?.messages) ? upsert.messages.length : 0,
			});

			if (!upsert || !Array.isArray(upsert.messages)) {
				return;
			}
			await this.handleMessages(upsert.messages);
		});

		this.logger.info("Food announcements inbound adapter listening for messages", {
			targetGroupJid: this.targetGroupJid,
		});
	}

	/**
	 * Processes a batch of raw inbound WAMessages.
	 */
	async handleMessages(messages: WAMessage[]): Promise<void> {
		for (const msg of messages) {
			try {
				await this.processMessage(msg);
			} catch (err) {
				this.logger.error("Unexpected error processing food announcement message", err, {
					messageId: msg?.key?.id,
					remoteJid: msg?.key?.remoteJid,
				});
			}
		}
	}

	/**
	 * Evaluates, unwraps, downloads media, and stores a single message.
	 */
	private async processMessage(msg: WAMessage): Promise<void> {
		if (!msg?.key) {
			this.logger.debug("Ignored malformed WAMessage missing key envelope");
			return;
		}

		const messageId = msg.key.id;
		const remoteJid = msg.key.remoteJid;
		const fromMe = msg.key.fromMe;

		this.logger.debug("Evaluating inbound message for food announcements", {
			messageId,
			remoteJid,
			targetGroupJid: this.targetGroupJid,
			isMatch: remoteJid === this.targetGroupJid,
			fromMe,
		});

		// 1. Group filtering: Only listen to target announcements group
		if (remoteJid !== this.targetGroupJid) {
			this.logger.debug("Ignored message: remoteJid does not match targetGroupJid", {
				messageId,
				receivedRemoteJid: remoteJid,
				expectedTargetGroupJid: this.targetGroupJid,
			});
			return;
		}

		// 2. Reject self-messages silently
		if (fromMe === true) {
			this.logger.debug("Ignored message: fromMe is true (sent by bot)", { messageId });
			return;
		}

		// 3. Must have a valid WhatsApp message ID (wamid)
		if (!messageId) {
			this.logger.debug("Ignored message: missing messageId");
			return;
		}

		// 4. Resolve sender participant
		const rawParticipant = msg.key.participant ?? (msg as any).participant;
		this.logger.debug("Resolving participant for group message", {
			messageId,
			rawParticipant,
		});

		if (!rawParticipant) {
			this.logger.debug("Ignored food announcement message missing participant", {
				messageId,
			});
			return;
		}

		const normalizedSender = WhatsAppJid.normalize(rawParticipant);
		const senderAddress = normalizedSender ?? String(rawParticipant).trim().toLowerCase();
		const senderAddressType: "pn" | "lid" = WhatsAppJid.isLidUser(senderAddress) ? "lid" : "pn";

		this.logger.debug("Resolved sender participant identity", {
			messageId,
			senderAddress,
			senderAddressType,
		});

		// 5. Inspect and unwrap message content
		const rawMessage = msg.message;
		this.logger.debug("Raw message structure keys", {
			messageId,
			hasMessage: Boolean(rawMessage),
			rawKeys: rawMessage ? Object.keys(rawMessage) : [],
		});

		const unwrapped = normalizeMessageContent(rawMessage);
		if (!unwrapped) {
			this.logger.debug("normalizeMessageContent returned null or empty for message", {
				messageId,
			});
			return;
		}

		this.logger.debug("Unwrapped message content keys", {
			messageId,
			unwrappedKeys: Object.keys(unwrapped),
		});

		let messageType: "image" | "document" | "text" | null = null;
		let mediaMimeType: string | null = null;
		let textBody: string | null = null;

		if (unwrapped.imageMessage) {
			messageType = "image";
			mediaMimeType = unwrapped.imageMessage.mimetype ?? "image/jpeg";
			textBody = unwrapped.imageMessage.caption ?? null;
			this.logger.debug("Detected imageMessage", { messageId, mediaMimeType, textBody });
		} else if (unwrapped.documentMessage) {
			messageType = "document";
			mediaMimeType = unwrapped.documentMessage.mimetype ?? "application/pdf";
			textBody = unwrapped.documentMessage.caption ?? unwrapped.documentMessage.fileName ?? null;
			this.logger.debug("Detected documentMessage", { messageId, mediaMimeType, textBody });
		} else if (unwrapped.conversation !== undefined && unwrapped.conversation !== null) {
			messageType = "text";
			mediaMimeType = null;
			textBody = unwrapped.conversation;
			this.logger.debug("Detected conversation text", { messageId, textBody });
		} else if (
			unwrapped.extendedTextMessage?.text !== undefined &&
			unwrapped.extendedTextMessage?.text !== null
		) {
			messageType = "text";
			mediaMimeType = null;
			textBody = unwrapped.extendedTextMessage.text;
			this.logger.debug("Detected extendedTextMessage text", { messageId, textBody });
		}

		if (!messageType) {
			this.logger.debug("Ignored unsupported message type in food announcements group", {
				messageId,
				availableKeys: Object.keys(unwrapped),
			});
			return;
		}

		// 6. Download media buffer if image or document
		let mediaBuffer: Buffer | null = null;
		if (messageType === "image" || messageType === "document") {
			this.logger.debug("Downloading media buffer for message", {
				messageId,
				messageType,
				mediaMimeType,
			});
			try {
				const downloaded = await this.downloadMedia(msg, "buffer", {});
				mediaBuffer = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded as any);
				this.logger.debug("Successfully downloaded media buffer", {
					messageId,
					bufferBytes: mediaBuffer.length,
				});
			} catch (mediaError) {
				this.logger.error("Failed to download media for food announcement message", mediaError, {
					messageId,
					remoteJid,
				});
			}
		}

		// 7. Idempotent insertion into staging inbox
		this.logger.debug(
			"Attempting database insert into whatsapp_group_food_announcements_messages",
			{
				messageId,
				senderAddress,
				senderAddressType,
				messageType,
				hasText: Boolean(textBody),
				hasMedia: Boolean(mediaBuffer),
			},
		);

		try {
			const result = await this.db
				.insert(whatsappGroupFoodAnnouncementsMessages)
				.values({
					id: messageId,
					senderAddress,
					senderAddressType,
					messageType,
					textBody,
					mediaMimeType,
					mediaBuffer,
					status: "pending",
				})
				.onConflictDoNothing();

			this.logger.info("Staged food announcement message into database successfully", {
				messageId,
				senderAddress,
				messageType,
				result,
			});
		} catch (dbError) {
			this.logger.error("Failed to store food announcement message in database", dbError, {
				messageId,
			});
		}
	}
}
