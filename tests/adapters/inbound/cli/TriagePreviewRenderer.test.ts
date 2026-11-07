import { TriageWeeklyMenuRenderer } from "../../../../src/adapters/inbound/cli/TriageWeeklyMenuRenderer";
import { TriageCompositeRenderer } from "../../../../src/adapters/inbound/cli/TriageCompositeRenderer";
import { describe, it, expect } from "vitest";
import { TriagePreviewRenderer } from "../../../../src/adapters/inbound/cli/TriagePreviewRenderer";
import type {
	StagedWeeklyMenu,
	LocationUpdate,
	TimingUpdate,
	DishUpdate,
} from "../../../../src/core/entities/MessAnnouncement";
import type { ExtractedCompositeAnnouncement } from "../../../../src/adapters/common/mess/ExtractionSchemas";

describe("TriagePreviewRenderer", () => {
	const renderer = new TriagePreviewRenderer(
		new TriageWeeklyMenuRenderer({ enableAnsi: false }),
		new TriageCompositeRenderer({ enableAnsi: false }),
		{ enableAnsi: false },
	);

	it("renders weekly menu preview", () => {
		const menu: StagedWeeklyMenu = {
			vendor: "cheftalk_regular",
			meals: [
				{ mealDate: "2026-10-12", mealSlot: "breakfast", items: ["Poha", "Tea"] },
				{ mealDate: "2026-10-12", mealSlot: "lunch", items: ["Dal", "Rice"] },
				{ mealDate: "2026-10-12", mealSlot: "dinner", items: ["Roti", "Sabzi"] },
			],
		};
		const preview = renderer.renderWeeklyMenuPreview(menu);
		expect(preview).toContain("WEEKLY MENU EXTRACTION PREVIEW");
		expect(preview).toContain("Vendor:         cheftalk_regular");
		expect(preview).toContain("Total Dishes:   6 items");
		expect(preview).toContain("2026-10-12 (Monday)");
		expect(preview).toContain("Breakfast [2 items]: Poha, Tea");
	});

	it("renders location detail preview", () => {
		const detail: LocationUpdate = {
			mealDate: "2026-10-12",
			mealSlot: "lunch",
			hostelBatches: ["Batch 2024", "Batch 2025"],
			collegeBatches: ["Batch 2023"],
		};
		const preview = renderer.renderLocationDetailPreview(detail);
		expect(preview).toContain("LUNCH SEATING ALLOCATION PREVIEW");
		expect(preview).toContain("Hostel Mess (Cheftalk Regular & Jain):");
		expect(preview).toContain("Batch 2024, Batch 2025");
		expect(preview).toContain("College Mess (TCB):");
		expect(preview).toContain("Batch 2023");
	});

	it("renders timing extension preview", () => {
		const ext: TimingUpdate = {
			mealDate: "2026-10-12",
			mealSlot: "dinner",
			targetVendor: "cheftalk_regular",
			extendedTimings: "08:00 PM - 10:30 PM",
		};
		const preview = renderer.renderTimingExtensionPreview(ext);
		expect(preview).toContain("MEAL TIMING EXTENSION PREVIEW");
		expect(preview).toContain('Extended Timings:  "08:00 PM - 10:30 PM"');
	});

	it("renders meal change preview", () => {
		const change: DishUpdate = {
			mealDate: "2026-10-12",
			mealSlot: "breakfast",
			targetVendor: "cheftalk_regular",
			changeType: "replacement",
			originalItem: "Upma",
			affectedItem: "Idli Sambar",
		};
		const preview = renderer.renderMealChangePreview(change);
		expect(preview).toContain("MEAL CHANGE / REPLACEMENT PREVIEW");
		expect(preview).toContain("Original Dish:     Upma");
		expect(preview).toContain("New / Replaced:    Idli Sambar");
	});

	it("renders composite announcement card with missing swaps", () => {
		const composite: ExtractedCompositeAnnouncement = {
			mealDate: "2026-10-12",
			location: {
				mealDate: "2026-10-12",
				mealSlot: "lunch",
				hostelBatches: ["Batch A"],
				collegeBatches: [],
			},
			mealSwaps: [
				{
					targetMealDate: "2026-10-12",
					targetMealSlot: "lunch",
					sourceMealDate: "2026-10-13",
					sourceMealSlot: "dinner",
				},
			],
			timingExtensions: [],
			mealChanges: [],
		};
		const missingSwap = {
			targetMealDate: "2026-10-12",
			targetMealSlot: "lunch" as const,
			sourceMealDate: "2026-10-13",
			sourceMealSlot: "dinner" as const,
			missingReason: "target" as const,
		};
		const preview = renderer.renderCompositeAnnouncementCard(composite, [], [missingSwap]);
		expect(preview).toContain("Extracted Announcement Events");
		expect(preview).toContain(
			"Cannot Commit Swap: Target menu for 2026-10-12 Lunch not found in database",
		);
	});
});
