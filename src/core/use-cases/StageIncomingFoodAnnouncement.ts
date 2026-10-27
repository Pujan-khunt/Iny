import { MessStagingRepositoryPort } from "../ports/MessStagingRepositoryPort";
import { LoggerPort } from "../ports/LoggerPort";

/**
 * Command payload for staging an incoming food announcement message.
 */
export interface StageFoodAnnouncementCommand {
	readonly id: string;
	readonly senderAddress: string;
	readonly senderAddressType: "pn" | "lid";
	readonly messageType: "image" | "document" | "text";
	readonly textBody: string | null;
	readonly mediaMimeType: string | null;
	readonly mediaBuffer: Buffer | null;
	readonly receivedAt?: Date;
}

/**
 * Use case that validates and stages incoming food announcement messages.
 * Enforces ingestion idempotency by inspecting staging repository results.
 */
export class StageIncomingFoodAnnouncement {
	constructor(
		private readonly stagingRepository: MessStagingRepositoryPort,
		private readonly logger: LoggerPort,
	) {}

	/**
	 * Validates the announcement command and stages the pending record.
	 * Idempotently ignores duplicate messages during historical replay.
	 *
	 * @param command Validated staging command.
	 */
	async execute(command: StageFoodAnnouncementCommand): Promise<void> {
		this.validateCommand(command);
		const result = await this.stagingRepository.stageMessage({
			...command,
			status: "pending",
		});

		if (result === "already_staged") {
			this.logger.debug("Food announcement message already staged, ignoring duplicate", {
				id: command.id,
			});
			return;
		}

		this.logger.info("Food announcement message staged successfully", {
			id: command.id,
		});
	}

	/**
	 * Validates mandatory fields and content presence on the command.
	 */
	private validateCommand(command: StageFoodAnnouncementCommand): void {
		if (!command.id || command.id.trim() === "") {
			throw new Error("Invalid announcement command: id is required");
		}
		if (!command.senderAddress || command.senderAddress.trim() === "") {
			throw new Error("Invalid announcement command: senderAddress is required");
		}
		const hasText = command.textBody !== null && command.textBody.trim() !== "";
		const hasMedia = command.mediaBuffer !== null;
		if (!hasText && !hasMedia) {
			throw new Error("Invalid announcement command: message must have text body or media content");
		}
	}
}
