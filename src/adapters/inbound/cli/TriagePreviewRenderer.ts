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
import {
	type AnsiTheme,
	RAW_ANSI,
	NO_ANSI,
	DIVIDER_LINE,
	formatIstAmPm,
	getDayOfWeekName,
} from "./TriageAnsi";
import { TriageWeeklyMenuRenderer } from "./TriageWeeklyMenuRenderer";
import { TriageCompositeRenderer } from "./TriageCompositeRenderer";

export interface TriagePreviewRendererOptions {
	enableAnsi?: boolean;
}

export class TriagePreviewRenderer {
	private readonly ansi: AnsiTheme;
	private readonly weeklyMenuRenderer: TriageWeeklyMenuRenderer;
	private readonly compositeRenderer: TriageCompositeRenderer;

	constructor(options?: TriagePreviewRendererOptions) {
		this.ansi = options?.enableAnsi === false ? NO_ANSI : RAW_ANSI;
		this.weeklyMenuRenderer = new TriageWeeklyMenuRenderer(options);
		this.compositeRenderer = new TriageCompositeRenderer(options);
	}

	renderWeeklyMenuPreview(menu: ExtractedWeeklyMenu): string {
		return this.weeklyMenuRenderer.render(menu);
	}

	renderLocationDetailPreview(
		detail: ExtractedLocationDetail,
		message?: StagedAnnouncementMessage,
	): string {
		const border = this.ansi.bold + DIVIDER_LINE + this.ansi.reset;
		const hostel = detail.hostelBatches.length > 0 ? detail.hostelBatches.join(", ") : "None";
		const college = detail.collegeBatches.length > 0 ? detail.collegeBatches.join(", ") : "None";

		return [
			border,
			`${this.ansi.bold}${this.ansi.cyan}📍 ${detail.mealSlot.toUpperCase()} SEATING ALLOCATION PREVIEW${this.ansi.reset}`,
			border,
			`Message Timestamp: ${formatIstAmPm(message?.receivedAt)}`,
			`Target Meal Date:  ${detail.mealDate} (${getDayOfWeekName(detail.mealDate)})`,
			`Target Meal Slot:  ${detail.mealSlot}`,
			"",
			`🏢 ${this.ansi.bold}Hostel Mess (Cheftalk Regular & Jain):${this.ansi.reset}`,
			`   Allocated Batches: ${hostel}`,
			"",
			`🏫 ${this.ansi.bold}College Mess (TCB):${this.ansi.reset}`,
			`   Allocated Batches: ${college}`,
			border,
			"Database Action:",
			"  • Upsert 1 row into 'mess_meal_location_details' on conflict (meal_date, meal_slot) DO UPDATE",
			"  • Update staging message status = 'processed'",
			border,
			"Actions:",
			`  ${this.ansi.bold}[y]${this.ansi.reset} Confirm & Commit`,
			`  ${this.ansi.bold}[d]${this.ansi.reset} Change Date (current: ${detail.mealDate})`,
			`  ${this.ansi.bold}[e]${this.ansi.reset} Edit Batches in vim`,
			`  ${this.ansi.bold}[c]${this.ansi.reset} Cancel`,
			DIVIDER_LINE,
		].join("\n");
	}

	renderTimingExtensionPreview(
		extension: ExtractedTimingExtension,
		message?: StagedAnnouncementMessage,
	): string {
		const border = this.ansi.bold + DIVIDER_LINE + this.ansi.reset;
		const vendorStr = extension.targetVendor ? extension.targetVendor : "All Vendors (Global)";

		return [
			border,
			`${this.ansi.bold}${this.ansi.cyan}⏰ MEAL TIMING EXTENSION PREVIEW${this.ansi.reset}`,
			border,
			`Message Timestamp: ${formatIstAmPm(message?.receivedAt)}`,
			`Target Meal Date:  ${extension.mealDate} (${getDayOfWeekName(extension.mealDate)})`,
			`Target Meal Slot:  ${extension.mealSlot}`,
			`Target Vendor:     ${vendorStr}`,
			`Extended Timings:  "${extension.extendedTimings}"`,
			border,
			"Database Action:",
			"  • Insert 1 row into 'mess_meal_timing_extensions'",
			"  • Update staging message status = 'processed'",
			border,
			"Actions:",
			`  ${this.ansi.bold}[y]${this.ansi.reset} Confirm & Commit`,
			`  ${this.ansi.bold}[v]${this.ansi.reset} Assign to specific vendor (current: ${vendorStr} ➔ [0] ALL, [1] regular, [2] jain, [3] tcb)`,
			`  ${this.ansi.bold}[c]${this.ansi.reset} Cancel`,
			DIVIDER_LINE,
		].join("\n");
	}

	renderMealChangePreview(
		change: ExtractedMealChange,
		message?: StagedAnnouncementMessage,
	): string {
		const border = this.ansi.bold + DIVIDER_LINE + this.ansi.reset;

		return [
			border,
			`${this.ansi.bold}${this.ansi.cyan}🍲 MEAL CHANGE / REPLACEMENT PREVIEW${this.ansi.reset}`,
			border,
			`Message Timestamp: ${formatIstAmPm(message?.receivedAt)}`,
			`Target Meal Date:  ${change.mealDate} (${getDayOfWeekName(change.mealDate)})`,
			`Target Meal Slot:  ${change.mealSlot}`,
			`Target Vendor:     ${change.targetVendor}`,
			`Change Type:       ${change.changeType.toUpperCase()}`,
			"",
			`Original Dish:     ${change.originalItem ?? "None"}`,
			`New / Replaced:    ${change.affectedItem}`,
			border,
			"Database Action:",
			"  • Insert 1 row into 'mess_meal_changes'",
			"  • Update staging message status = 'processed'",
			border,
			"Actions:",
			`  ${this.ansi.bold}[y]${this.ansi.reset} Confirm & Commit`,
			`  ${this.ansi.bold}[t]${this.ansi.reset} Change Type (current: ${change.changeType.toUpperCase()} ➔ [1] replacement, [2] addition, [3] cancellation)`,
			`  ${this.ansi.bold}[c]${this.ansi.reset} Cancel`,
			DIVIDER_LINE,
		].join("\n");
	}

	renderCompositeAnnouncementCard(
		composite: ExtractedCompositeAnnouncement,
		resolvedSwaps?: ResolvedMealSwapInput[],
		missingSwaps?: ExtractedMealSwap[],
	): string {
		return this.compositeRenderer.render(composite, resolvedSwaps, missingSwaps);
	}
}
