import type { StagedAnnouncementMessage } from "../../../core/ports/MessStagingRepositoryPort";
import type { MenuExtractionPort } from "../../../core/ports/MenuExtractionPort";
import type { PdfRasterizationPort } from "../../../core/ports/PdfRasterizationPort";
import type { CliIo } from "./TriageIo";
import type { TriageTerminalView } from "./TriageTerminalView";
import type { TriageWeeklyMenuReview } from "./TriageWeeklyMenuReview";

/** Extracts manual image/PDF menus and hands independent evidence to review. */
export class TriageWeeklyMenuController {
	/** Injects extraction and rasterization ports; starts no automatic processing. */
	constructor(
		private readonly io: CliIo,
		private readonly view: TriageTerminalView,
		private readonly extractor: MenuExtractionPort,
		private readonly rasterizer: PdfRasterizationPort,
		private readonly review: TriageWeeklyMenuReview,
	) {}
	/** Retries extraction only when requested; cancel returns to the inbox. */
	async run(message: StagedAnnouncementMessage): Promise<void> {
		while (true) {
			let extraction;
			try {
				this.io.print("\n⏳ Extracting weekly menu via DeepSeek vision engine...");
				extraction = await this.extract(message);
			} catch (error: unknown) {
				if (await this.shouldRetry(error, message.id)) continue;
				return;
			}
			await this.review.run(message, extraction);
			return;
		}
	}

	private async shouldRetry(error: unknown, messageId: string): Promise<boolean> {
		this.io.print(this.view.renderExtractionErrorCard(error, messageId));
		const choice = await this.io.prompt("Choice [r/c]: ");
		return choice.toLowerCase() === "r";
	}
	private async extract(message: StagedAnnouncementMessage) {
		if (!message.mediaBuffer)
			throw new Error("Weekly menu extraction requires image or PDF media attachment.");
		let bytes = Buffer.from(message.mediaBuffer);
		let mimeType = message.mediaMimeType ?? "image/png";
		if (mimeType === "application/pdf" || bytes.subarray(0, 4).toString().startsWith("%PDF")) {
			bytes = Buffer.from((await this.rasterizer.renderFirstPage(bytes)).pngBytes);
			mimeType = "image/png";
		}
		return this.extractor.extractWeeklyMenu(bytes, {
			mimeType,
			textContext: message.textBody ?? undefined,
		});
	}
}
