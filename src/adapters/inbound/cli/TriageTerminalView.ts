import type {
	StagedAnnouncementMessage,
	ResolvedMealSwapInput,
} from "../../../core/ports/MessStagingRepositoryPort";
import type {
	ExtractedWeeklyMenu,
	ExtractedLocationDetail,
	ExtractedTimingExtension,
	ExtractedMealChange,
	ExtractedMealSwap,
	ExtractedCompositeAnnouncement,
} from "../../outbound/mess/extraction/ExtractionSchemas";
import { stripAnsi } from "./TriageAnsi";
import { TriageMenuRenderer } from "./TriageMenuRenderer";
import { TriagePreviewRenderer } from "./TriagePreviewRenderer";

export { stripAnsi };

export interface TriageTerminalViewOptions {
	enableAnsi?: boolean;
}

export class TriageTerminalView {
	private readonly menuRenderer: TriageMenuRenderer;
	private readonly previewRenderer: TriagePreviewRenderer;

	constructor(options?: TriageTerminalViewOptions) {
		this.menuRenderer = new TriageMenuRenderer(options);
		this.previewRenderer = new TriagePreviewRenderer(options);
	}

	renderMessagesTable(messages: StagedAnnouncementMessage[]): string {
		return this.menuRenderer.renderMessagesTable(messages);
	}

	renderInspectionCard(
		message: StagedAnnouncementMessage,
		selectedIntent?: string,
		selectedIntentIndex?: string | number,
	): string {
		return this.menuRenderer.renderInspectionCard(message, selectedIntent, selectedIntentIndex);
	}

	renderExtractionErrorCard(error: unknown, targetMessageId: string): string {
		return this.menuRenderer.renderExtractionErrorCard(error, targetMessageId);
	}

	renderWeeklyMenuPreview(menu: ExtractedWeeklyMenu): string {
		return this.previewRenderer.renderWeeklyMenuPreview(menu);
	}

	renderLocationDetailPreview(
		detail: ExtractedLocationDetail,
		message?: StagedAnnouncementMessage,
	): string {
		return this.previewRenderer.renderLocationDetailPreview(detail, message);
	}

	renderTimingExtensionPreview(
		extension: ExtractedTimingExtension,
		message?: StagedAnnouncementMessage,
	): string {
		return this.previewRenderer.renderTimingExtensionPreview(extension, message);
	}

	renderMealChangePreview(
		change: ExtractedMealChange,
		message?: StagedAnnouncementMessage,
	): string {
		return this.previewRenderer.renderMealChangePreview(change, message);
	}

	renderIgnorePreview(message: StagedAnnouncementMessage): string {
		return this.menuRenderer.renderIgnorePreview(message);
	}

	renderProcessedMessageCard(message: StagedAnnouncementMessage): string {
		return this.menuRenderer.renderProcessedMessageCard(message);
	}

	renderCompositeAnnouncementCard(
		composite: ExtractedCompositeAnnouncement,
		resolvedSwaps?: ResolvedMealSwapInput[],
		missingSwaps?: ExtractedMealSwap[],
	): string {
		return this.previewRenderer.renderCompositeAnnouncementCard(
			composite,
			resolvedSwaps,
			missingSwaps,
		);
	}
}
