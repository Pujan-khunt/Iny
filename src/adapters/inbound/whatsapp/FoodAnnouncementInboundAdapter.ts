import { LoggerPort } from "../../../core/ports/LoggerPort";
import {
	StageFoodAnnouncementCommand,
	StageIncomingFoodAnnouncement,
} from "../../../core/use-cases/StageIncomingFoodAnnouncement";
import {
	NormalizedWhatsAppMessage,
	WhatsAppMessageHandler,
	WhatsAppUpsertType,
} from "./router/NormalizedWhatsAppMessage";

/** Configured group scope and required food capture collaborators. */
export interface FoodAnnouncementInboundAdapterOptions {
	readonly targetGroupJid: string;
	readonly useCase: StageIncomingFoodAnnouncement;
	readonly logger: LoggerPort;
}

/**
 * Driving inbound adapter that matches food announcements posted in the official group chat,
 * downloads required binary media attachments via lazy closure, maps them into
 * StageFoodAnnouncementCommand payloads, and stages them via StageIncomingFoodAnnouncement.
 *
 * Invariant: Never sends any outbound replies to the food announcement group.
 */
export class FoodAnnouncementInboundAdapter implements WhatsAppMessageHandler {
	readonly name = "food-announcement";
	readonly acceptedUpsertTypes: readonly WhatsAppUpsertType[] = ["notify", "append"] as const;

	private readonly targetGroupJid: string;
	private readonly useCase: StageIncomingFoodAnnouncement;
	private readonly logger: LoggerPort;

	/** Receives configured group scope, atomic staging use case, and logging. */
	constructor(options: FoodAnnouncementInboundAdapterOptions) {
		this.targetGroupJid = options.targetGroupJid;
		this.useCase = options.useCase;
		this.logger = options.logger;
	}

	/** Accepts supported content exclusively from the configured group. */
	matches(message: NormalizedWhatsAppMessage): boolean {
		if (message.chatJid !== this.targetGroupJid) return false;
		if (message.chatType !== "group") return false;

		const reason = this.resolveFilterReason(message);
		if (reason) {
			const rawKeys = message.content.type === "unsupported" ? message.content.rawKeys : undefined;
			this.logger.debug("Food announcement handler skipped target group message", {
				messageId: message.messageId,
				reason,
				contentPreview: message.content.preview,
				rawKeys,
			});
			return false;
		}
		return true;
	}

	private resolveFilterReason(message: NormalizedWhatsAppMessage): string | null {
		if (message.content.type === "unsupported") return "unsupported_content_type";
		if (message.content.type === "text") {
			if (!message.content.text || message.content.text.trim().length === 0) return "empty_text";
		}
		return null;
	}

	/** Downloads matched media lazily and captures source provenance; failures reject with a phase. */
	async handle(message: NormalizedWhatsAppMessage): Promise<void> {
		if (!this.matches(message)) return;
		const capturedAt = new Date();
		let phase = "download";
		try {
			const mediaBytes = message.content.type === "text" ? null : await message.downloadMedia();
			if (message.content.type !== "text" && !mediaBytes?.byteLength)
				throw new Error("Food announcement media download returned no content");
			if (mediaBytes) {
				this.logger.debug("Downloaded media attachment for food announcement", {
					messageId: message.messageId,
					mediaMimeType: message.content.mimeType,
					bufferSize: mediaBytes.length,
				});
			}
			phase = "capture";
			await this.useCase.execute(this.source(message, mediaBytes, capturedAt));
		} catch (error) {
			this.logger.error("Food announcement handling failed", error, {
				messageId: message.messageId,
				phase,
			});
			throw error;
		}
	}

	private source(
		message: NormalizedWhatsAppMessage,
		mediaBytes: Uint8Array | null,
		capturedAt: Date,
	): StageFoodAnnouncementCommand {
		return {
			messageId: message.messageId,
			groupJid: message.chatJid,
			senderAddress: message.senderJid,
			senderAddressType: message.senderType,
			deliveryMode: message.upsertType,
			originalCreatedAt:
				message.originalTimestamp === null ? null : new Date(message.originalTimestamp),
			capturedAt,
			messageType: message.content.type as "image" | "document" | "text",
			textBody: message.content.text,
			mediaMimeType: message.content.mimeType,
			mediaBytes,
		};
	}
}
