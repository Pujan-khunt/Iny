import type { ResolvedMealSwapInput } from "../../../core/ports/MessStagingRepositoryPort";
import type {
	ExtractedCompositeAnnouncement,
	ExtractedMealSwap,
} from "../../outbound/mess/extraction/ExtractionSchemas";
import { type AnsiTheme, RAW_ANSI, NO_ANSI } from "./TriageAnsi";

export interface TriageCompositeRendererOptions {
	enableAnsi?: boolean;
}

export class TriageCompositeRenderer {
	private readonly ansi: AnsiTheme;

	constructor(options?: TriageCompositeRendererOptions) {
		this.ansi = options?.enableAnsi === false ? NO_ANSI : RAW_ANSI;
	}

	render(
		composite: ExtractedCompositeAnnouncement,
		resolvedSwaps?: ResolvedMealSwapInput[],
		missingSwaps?: ExtractedMealSwap[],
	): string {
		const header = `${this.ansi.bold}${this.ansi.cyan}┌─ Extracted Announcement Events (Date: ${composite.mealDate}) ──────────────────────────┐${this.ansi.reset}`;
		const footer =
			"└─────────────────────────────────────────────────────────────────────────────┘";

		return [
			header,
			this.formatLocationSection(composite.location),
			...this.formatTimingLines(composite.timingExtensions),
			...this.formatChangesLines(composite.mealChanges),
			...this.formatSwapsLines(composite.mealSwaps, resolvedSwaps),
			footer,
			...this.formatMissingSwaps(missingSwaps),
		].join("\n");
	}

	private formatLocationSection(loc: ExtractedCompositeAnnouncement["location"]): string {
		if (!loc) return "│  📍 Location: None";
		const slotStr = loc.mealSlot
			? `(${loc.mealSlot.charAt(0).toUpperCase() + loc.mealSlot.slice(1)})`
			: "(Lunch)";
		const hostel = Boolean(loc.hostelBatches && loc.hostelBatches.length > 0);
		const college = Boolean(loc.collegeBatches && loc.collegeBatches.length > 0);
		if (hostel && college) {
			return `│  📍 Location: ${loc.hostelBatches!.join(", ")} in Hostel | ${loc.collegeBatches!.join(", ")} in College ${slotStr}`;
		}
		if (hostel) {
			return `│  📍 Location: ${loc.hostelBatches!.join(", ")} in Hostel ${slotStr}`;
		}
		if (college) {
			return `│  📍 Location: ${loc.collegeBatches!.join(", ")} in College ${slotStr}`;
		}
		return `│  📍 Location: None ${slotStr}`;
	}

	private formatTimingLines(
		extensions?: ExtractedCompositeAnnouncement["timingExtensions"],
	): string[] {
		if (!extensions || extensions.length === 0) return ["│  ⏰ Timing: None"];
		return extensions.map((t) => {
			const slotCap = t.mealSlot.charAt(0).toUpperCase() + t.mealSlot.slice(1);
			const vendorStr = t.targetVendor ? ` (${t.targetVendor})` : "";
			return `│  ⏰ Timing: ${slotCap}${vendorStr} ${t.extendedTimings}`;
		});
	}

	private formatChangesLines(changes?: ExtractedCompositeAnnouncement["mealChanges"]): string[] {
		if (!changes || changes.length === 0) return ["│  🔄 Changes: None"];
		return changes.map((c) => {
			const slotCap = c.mealSlot.charAt(0).toUpperCase() + c.mealSlot.slice(1);
			const vendorStr = c.targetVendor ? ` (${c.targetVendor})` : "";
			const desc =
				c.changeType === "replacement" && c.originalItem
					? `${c.originalItem} -> ${c.affectedItem} [${c.changeType}]`
					: `${c.affectedItem} [${c.changeType}]`;
			return `│  🔄 Changes: ${slotCap}${vendorStr}: ${desc}`;
		});
	}

	private formatSwapsLines(
		swaps?: ExtractedMealSwap[],
		resolved?: ResolvedMealSwapInput[],
	): string[] {
		if (!swaps || swaps.length === 0) return ["│  🔁 Swaps: None"];
		const lines: string[] = [];
		for (const s of swaps) {
			const targetSlot = s.targetMealSlot.charAt(0).toUpperCase() + s.targetMealSlot.slice(1);
			const sourceSlot = s.sourceMealSlot.charAt(0).toUpperCase() + s.sourceMealSlot.slice(1);
			lines.push(
				`│  🔁 Meal Swap: ${s.targetMealDate} ${targetSlot} <- ${s.sourceMealDate} ${sourceSlot}`,
			);
			const matches = resolved?.filter(
				(r) =>
					r.targetMealDate === s.targetMealDate &&
					r.targetMealSlot === s.targetMealSlot &&
					r.sourceMealDate === s.sourceMealDate &&
					r.sourceMealSlot === s.sourceMealSlot,
			);
			if (matches && matches.length > 0) {
				for (const r of matches) {
					const vendorLabel = r.vendor ? ` (${r.vendor})` : "";
					lines.push(`│     Resolved Items${vendorLabel}: [${r.newItems.join(", ")}]`);
				}
			}
		}
		return lines;
	}

	private formatMissingSwaps(missing?: ExtractedMealSwap[]): string[] {
		if (!missing || missing.length === 0) {
			return [
				`Actions: ${this.ansi.bold}[y]${this.ansi.reset} Confirm & Commit | ${this.ansi.bold}[e]${this.ansi.reset} Edit in Neovim | ${this.ansi.bold}[c]${this.ansi.reset} Cancel`,
			];
		}
		const lines: string[] = [];
		for (const m of missing) {
			const reason = (m as { missingReason?: string }).missingReason;
			const isTarget = reason === "target";
			const slot = isTarget ? m.targetMealSlot : m.sourceMealSlot;
			const date = isTarget ? m.targetMealDate : m.sourceMealDate;
			const slotCap = slot.charAt(0).toUpperCase() + slot.slice(1);
			const label = isTarget ? "Target" : "Source";
			lines.push(
				`${this.ansi.bold}${this.ansi.red}❌ Cannot Commit Swap: ${label} menu for ${date} ${slotCap} not found in database. Please ingest that date's weekly menu before committing this announcement.${this.ansi.reset}`,
			);
		}
		lines.push(
			`Actions: ${this.ansi.bold}[e]${this.ansi.reset} Edit in Neovim | ${this.ansi.bold}[c]${this.ansi.reset} Cancel`,
		);
		return lines;
	}
}
