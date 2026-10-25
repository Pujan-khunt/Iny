import { downloadMediaMessage, WAMessage } from "@whiskeysockets/baileys";
import { MessStagingRepositoryPort } from "../../../core/ports/MessStagingRepositoryPort";
import { BaileysConnectionManager } from "../../outbound/whatsapp/BaileysConnectionManager";
import { LoggerPort } from "../../../core/ports/LoggerPort";
import {
	FoodAnnouncementPayloadParser,
	ParsedFoodAnnouncementPayload,
} from "./FoodAnnouncementPayloadParser";

/**
 * Options required to initialize the FoodAnnouncementsInboundAdapter.
 */
export interface FoodAnnouncementsInboundAdapterOptions {
	targetGroupJid: string;
	stagingRepository: MessStagingRepositoryPort;
	connectionManager: BaileysConnectionManager;
	logger: LoggerPort;
	downloadMedia?: typeof downloadMediaMessage;
	payloadParser?: FoodAnnouncementPayloadParser;
}

/**
 * Inbound adapter that listens for broadcast messages from the official Food Announcements
 * WhatsApp group, normalizes sender and media content, downloads media attachments,
 * and stages raw records via MessStagingRepositoryPort for triage.
 *
 * Invariant: Never sends any reply message to the WhatsApp group.
 */
export class FoodAnnouncementsInboundAdapter {
	private readonly targetGroupJid: string;
	private readonly stagingRepository: MessStagingRepositoryPort;
	private readonly connectionManager: BaileysConnectionManager;
	private readonly logger: LoggerPort;
	private readonly downloadMedia: typeof downloadMediaMessage;
	private readonly payloadParser: FoodAnnouncementPayloadParser;

	constructor(options: FoodAnnouncementsInboundAdapterOptions) {
		this.targetGroupJid = options.targetGroupJid;
		this.stagingRepository = options.stagingRepository;
		this.connectionManager = options.connectionManager;
		this.logger = options.logger;
		this.downloadMedia = options.downloadMedia ?? downloadMediaMessage;
		this.payloadParser = options.payloadParser ?? new FoodAnnouncementPayloadParser(this.logger);
	}

	/**
	 * Subscribes to Baileys messages.upsert events.
	 */
	start(): void {
		this.connectionManager.subscribe(
			"messages.upsert",
			async (upsert: { type?: string; messages?: WAMessage[] }) => {
				this.logger.debug("Received messages.upsert event from Baileys", {
					type: upsert?.type,
					messageCount: Array.isArray(upsert?.messages) ? upsert.messages.length : 0,
				});

				if (!upsert || !Array.isArray(upsert.messages)) {
					return;
				}
				await this.handleMessages(upsert.messages);
			},
		);

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

	private async downloadMediaBuffer(
		msg: WAMessage,
		parsed: ParsedFoodAnnouncementPayload,
	): Promise<Buffer | null> {
		if (parsed.messageType !== "image" && parsed.messageType !== "document") {
			return null;
		}
		try {
			const downloaded = await this.downloadMedia(msg, "buffer", {});
			return Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded as Uint8Array);
		} catch (mediaError) {
			this.logger.error("Failed to download media for food announcement message", mediaError, {
				messageId: parsed.messageId,
				remoteJid: msg?.key?.remoteJid,
			});
			return null;
		}
	}

	/**
	 * Evaluates, unwraps, downloads media, and stores a single message.
	 */
	private async processMessage(msg: WAMessage): Promise<void> {
		const parsed = this.payloadParser.parse(msg, this.targetGroupJid);
		if (!parsed) {
			return;
		}

		const mediaBuffer = await this.downloadMediaBuffer(msg, parsed);

		try {
			await this.stagingRepository.stageMessage({
				id: parsed.messageId,
				senderAddress: parsed.senderAddress,
				senderAddressType: parsed.senderAddressType,
				messageType: parsed.messageType,
				textBody: parsed.textBody,
				mediaMimeType: parsed.mediaMimeType,
				mediaBuffer,
				status: "pending",
			});

			this.logger.info("Staged food announcement message into database successfully", {
				messageId: parsed.messageId,
				senderAddress: parsed.senderAddress,
				messageType: parsed.messageType,
			});
		} catch (dbError) {
			this.logger.error("Failed to store food announcement message in database", dbError, {
				messageId: parsed.messageId,
			});
		}
	}
}
