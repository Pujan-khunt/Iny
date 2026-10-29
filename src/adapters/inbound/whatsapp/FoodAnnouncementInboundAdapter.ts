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

	constructor(options: FoodAnnouncementInboundAdapterOptions) {
		this.targetGroupJid = options.targetGroupJid;
		this.useCase = options.useCase;
		this.logger = options.logger;
	}

	matches(message: NormalizedWhatsAppMessage): boolean {
		if (message.fromMe || message.chatType !== "group" || message.chatJid !== this.targetGroupJid) {
			return false;
		}
		if (message.content.type === "text") {
			return Boolean(message.content.text && message.content.text.trim().length > 0);
		}
		return message.content.type === "image" || message.content.type === "document";
	}

	async handle(message: NormalizedWhatsAppMessage): Promise<void> {
		const mediaBuffer = await message.downloadMedia();
		if (mediaBuffer) {
			this.logger.debug("Downloaded media attachment for food announcement", {
				messageId: message.messageId,
				mediaMimeType: message.content.mimeType,
				bufferSize: mediaBuffer.length,
			});
		}

		const command: StageFoodAnnouncementCommand = {
			id: message.messageId,
			senderAddress: message.senderJid,
			senderAddressType: message.senderType,
			messageType: message.content.type as "image" | "document" | "text",
			textBody: message.content.text,
			mediaMimeType: message.content.mimeType,
			mediaBuffer,
			receivedAt: new Date(message.timestamp),
		};

		await this.useCase.execute(command);
	}
}
