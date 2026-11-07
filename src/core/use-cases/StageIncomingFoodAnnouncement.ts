import type { FoodAnnouncementSource } from "../entities/FoodAnnouncement";
import type { FoodIngestionRepositoryPort } from "../ports/FoodIngestionRepositoryPort";
import type { LoggerPort } from "../ports/LoggerPort";

/** Pure original source contract for atomic staging and automatic admission. */
export type StageFoodAnnouncementCommand = FoodAnnouncementSource;

/** Validates raw source content and requests one atomic capture/admission operation. */
export class StageIncomingFoodAnnouncement {
	/** Injects the atomic persistence boundary and source-scoped diagnostic logger. */
	constructor(
		private readonly repository: FoodIngestionRepositoryPort,
		private readonly logger: LoggerPort,
	) {}

	/**
	 * Captures a validated source once, preserving ineligibility and duplicate decisions.
	 * @param source Original transport provenance and actual text or media content.
	 * @returns Resolves after capture; validation and persistence failures reject for transport retry.
	 */
	async execute(source: StageFoodAnnouncementCommand): Promise<void> {
		this.validateCommand(source);
		try {
			const result = await this.repository.capture(source);
			const context = { messageId: source.messageId, phase: "capture", result };
			if (result === "duplicate") {
				this.logger.debug("Food announcement already captured", context);
				return;
			}
			this.logger.info("Food announcement captured successfully", context);
		} catch (error) {
			this.logger.error("Food announcement capture failed", error, {
				messageId: source.messageId,
				phase: "capture",
			});
			throw error;
		}
	}

	private validateCommand(source: StageFoodAnnouncementCommand): void {
		for (const field of ["messageId", "groupJid", "senderAddress"] as const) {
			if (!source[field] || source[field].trim() === "")
				throw new Error(`Invalid announcement command: ${field} is required`);
		}
		const hasText = typeof source.textBody === "string" && source.textBody.trim() !== "";
		const hasMedia = source.mediaBytes instanceof Uint8Array && source.mediaBytes.byteLength > 0;
		const validContent = source.messageType === "text" ? hasText : hasMedia;
		if (!validContent)
			throw new Error("Invalid announcement command: message must have actual content");
	}
}
