import type {
	StagedAnnouncementMessage,
	ResolvedMealSwapInput,
} from "../../../core/ports/MessStagingRepositoryPort";
import type {
	StagedWeeklyMenu,
	LocationUpdate,
	TimingUpdate,
	DishUpdate,
	StagedMealSwap,
	StagedCompositeAnnouncement,
} from "../../../core/entities/MessAnnouncement";
import { stripAnsi } from "./TriageAnsi";
import { TriageMenuRenderer } from "./TriageMenuRenderer";
import { TriagePreviewRenderer } from "./TriagePreviewRenderer";

export { stripAnsi };

/** Presents manual triage cards using injected renderers and plain core values. */
export class TriageTerminalView {
	/** Receives the menu and payload presentation collaborators. */
	constructor(
		private readonly menuRenderer: TriageMenuRenderer,
		private readonly previewRenderer: TriagePreviewRenderer,
	) {}

	/** Renders persisted automatic outcome and detail without modifying its state. */
	renderIngestionAudit(
		audit: import("../../../core/entities/MessCommit").MessIngestionAudit | null,
	): string {
		const decision = audit?.automatic;
		if (!decision) return "";
		return `Automatic ingestion: ${decision.state} | ${decision.decisionReason ?? ""}\n${decision.decisionDetail ?? ""}`;
	}
	/** Presents original and review correction chronology. */
	renderMenuCorrections(
		corrections: readonly import("../../../core/entities/MessAnnouncement").MenuCorrection[],
	): string {
		return corrections
			.map(
				(c) =>
					`${c.mealDate} ${c.mealSlot}: ${c.originalItem} -> ${c.correctedItem} (${c.aliasId})`,
			)
			.join("\n");
	}

	/** Returns a presentation card for the supplied core values. */
	renderMessagesTable(messages: StagedAnnouncementMessage[]): string {
		return this.menuRenderer.renderMessagesTable(messages);
	}

	/** Returns a presentation card for the supplied core values. */
	renderInspectionCard(
		message: StagedAnnouncementMessage,
		selectedIntent?: string,
		selectedIntentIndex?: string | number,
	): string {
		return this.menuRenderer.renderInspectionCard(message, selectedIntent, selectedIntentIndex);
	}

	/** Returns a presentation card for the supplied core values. */
	renderExtractionErrorCard(error: unknown, targetMessageId: string): string {
		return this.menuRenderer.renderExtractionErrorCard(error, targetMessageId);
	}

	/** Returns a presentation card for the supplied core values. */
	renderWeeklyMenuPreview(menu: StagedWeeklyMenu): string {
		return this.previewRenderer.renderWeeklyMenuPreview(menu);
	}

	/** Returns a presentation card for the supplied core values. */
	renderLocationDetailPreview(detail: LocationUpdate, message?: StagedAnnouncementMessage): string {
		return this.previewRenderer.renderLocationDetailPreview(detail, message);
	}

	/** Returns a presentation card for the supplied core values. */
	renderTimingExtensionPreview(
		extension: TimingUpdate,
		message?: StagedAnnouncementMessage,
	): string {
		return this.previewRenderer.renderTimingExtensionPreview(extension, message);
	}

	/** Returns a presentation card for the supplied core values. */
	renderMealChangePreview(change: DishUpdate, message?: StagedAnnouncementMessage): string {
		return this.previewRenderer.renderMealChangePreview(change, message);
	}

	/** Returns a presentation card for the supplied core values. */
	renderIgnorePreview(message: StagedAnnouncementMessage): string {
		return this.menuRenderer.renderIgnorePreview(message);
	}

	/** Returns a presentation card for the supplied core values. */
	renderProcessedMessageCard(message: StagedAnnouncementMessage): string {
		return this.menuRenderer.renderProcessedMessageCard(message);
	}

	/** Returns a presentation card for the supplied core values. */
	renderCompositeAnnouncementCard(
		composite: StagedCompositeAnnouncement,
		resolvedSwaps?: ResolvedMealSwapInput[],
		missingSwaps?: StagedMealSwap[],
	): string {
		return this.previewRenderer.renderCompositeAnnouncementCard(
			composite,
			resolvedSwaps,
			missingSwaps,
		);
	}
}
