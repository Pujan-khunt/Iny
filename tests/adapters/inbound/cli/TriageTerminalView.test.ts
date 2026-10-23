import { describe, it, expect } from "vitest";
import {
	TriageTerminalView,
	stripAnsi,
} from "../../../../src/adapters/inbound/cli/TriageTerminalView.js";
import type { WhatsappGroupFoodAnnouncementsMessageRow } from "../../../../src/adapters/outbound/mess/postgres/schema.js";
import type {
	ExtractedWeeklyMenu,
	ExtractedLocationDetail,
	ExtractedTimingExtension,
	ExtractedMealChange,
} from "../../../../src/adapters/outbound/mess/extraction/ExtractionSchemas.js";

describe("TriageTerminalView", () => {
	const view = new TriageTerminalView({ enableAnsi: false });

	const mockMessage: WhatsappGroupFoodAnnouncementsMessageRow = {
		id: "3EB0A1B2C3D4E5F6",
		senderAddress: "+919876543210",
		senderAddressType: "pn",
		messageType: "document",
		mediaMimeType: "application/pdf",
		mediaBuffer: Buffer.from("%PDF-1.4 test"),
		textBody: "WEEKLY MENU OCT 4-10-3.pdf",
		status: "pending",
		receivedAt: new Date("2026-10-08T06:12:15.000Z"),
		processedAt: null,
	};

	it("renders messages table with columns and formatting", () => {
		const table = view.renderMessagesTable([mockMessage]);
		expect(table).toContain("3EB0A1B2C3D4E5F6");
		expect(table).toContain("+919876543210 (pn)");
		expect(table).toContain("document");
		expect(table).toContain("pending");
	});

	it("renders pre-extraction inspection card matching Spec 4.2", () => {
		const card = view.renderInspectionCard(mockMessage, "Weekly Menu");
		expect(card).toContain("MESSAGE INSPECTION & CONFIRMATION");
		expect(card).toContain("3EB0A1B2C3D4E5F6");
		expect(card).toContain("+919876543210 (pn)");
		expect(card).toContain("document (application/pdf");
		expect(card).toContain("WEEKLY MENU OCT 4-10-3.pdf");
		expect(card).toContain("[1] Weekly Menu");
		expect(card).toContain("[y] Proceed with Extraction");
		expect(card).toContain("[o] Open Media");
		expect(card).toContain("[c] Cancel / Back to List");
	});

	it("renders inspection card with custom intent index (e.g. [2] Location Detail)", () => {
		const card = view.renderInspectionCard(mockMessage, "Location Detail", "2");
		expect(card).toContain("Selected Action:[2] Location Detail");
	});

	it("renders pure message inspection card when intent is omitted", () => {
		const card = view.renderInspectionCard(mockMessage);
		expect(card).toContain("MESSAGE INSPECTION");
		expect(card).not.toContain("CONFIRMATION");
		expect(card).toContain("3EB0A1B2C3D4E5F6");
		expect(card).toContain("+919876543210 (pn)");
		expect(card).not.toContain("Selected Action:");
	});

	it("renders non-fatal extraction error card matching Spec 4.2", () => {
		const errorCard = view.renderExtractionErrorCard(
			new Error("Rate limit reached for deepseek-flash. Please wait 5s."),
			"3EB0A1B2C3D4E5F6",
		);
		expect(errorCard).toContain("EXTRACTION ENCOUNTERED AN ERROR");
		expect(errorCard).toContain("Rate limit reached for deepseek-flash");
		expect(errorCard).toContain("3EB0A1B2C3D4E5F6");
		expect(errorCard).toContain("Staging State: UNCHANGED");
		expect(errorCard).toContain("[r] Retry Extraction");
		expect(errorCard).toContain("[c] Cancel & Return to Message List");
	});

	it("renders validation issues and raw LLM response in error card when present", () => {
		const errorWithDetails = {
			name: "LLMResponseError",
			message: "LLM response failed schema validation",
			cause: {
				issues: [
					{
						path: ["location", "mealDate"],
						message: "Invalid input: expected string, received undefined",
					},
				],
			},
			rawResponse: '{"mealDate":"2026-10-21","location":{}}',
		};

		const errorCard = view.renderExtractionErrorCard(errorWithDetails, "MSG_TEST_01");
		expect(errorCard).toContain("Validation Issues:");
		expect(errorCard).toContain(
			"location.mealDate: Invalid input: expected string, received undefined",
		);
		expect(errorCard).toContain("Raw LLM Response:");
		expect(errorCard).toContain('{"mealDate":"2026-10-21","location":{}}');
	});

	it("renders weekly menu extraction preview with 21 slots matching Spec 4.4", () => {
		const weeklyMenu: ExtractedWeeklyMenu = {
			vendor: "cheftalk_regular",
			meals: [
				{
					mealDate: "2026-10-04",
					mealSlot: "breakfast",
					items: ["Aloo Paratha", "Curd"],
				},
				{
					mealDate: "2026-10-04",
					mealSlot: "lunch",
					items: ["Paneer Butter Masala", "Rice"],
				},
				{
					mealDate: "2026-10-04",
					mealSlot: "dinner",
					items: ["Dal Fry", "Roti"],
				},
			] as any,
		};
		// Pad to 21 slots for testing
		const slots = ["breakfast", "lunch", "dinner"] as const;
		const days = [
			"2026-10-04",
			"2026-10-05",
			"2026-10-06",
			"2026-10-07",
			"2026-10-08",
			"2026-10-09",
			"2026-10-10",
		];
		weeklyMenu.meals = [];
		for (const d of days) {
			for (const s of slots) {
				weeklyMenu.meals.push({
					mealDate: d,
					mealSlot: s,
					items: ["Item 1", "Item 2"],
				});
			}
		}

		const preview = view.renderWeeklyMenuPreview(weeklyMenu);
		expect(preview).toContain("WEEKLY MENU EXTRACTION PREVIEW");
		expect(preview).toContain("cheftalk_regular");
		expect(preview).toContain("2026-10-04");
		expect(preview).toContain("2026-10-10");
		expect(preview).toContain("Total Slots:    21 meals");
		expect(preview).toContain("Contiguous 7-day span");
		expect(preview).toContain("[y] Confirm & Commit to Database");
		expect(preview).toContain("[v] Switch Vendor");
		expect(preview).toContain("[d] Shift Dates");
		expect(preview).toContain("[e] Edit in vim");
	});

	it("renders location seating preview matching Spec 4.4", () => {
		const locationData: ExtractedLocationDetail = {
			mealDate: "2026-10-08",
			mealSlot: "lunch",
			hostelBatches: ["UG1", "UG2", "PG1", "PhD"],
			collegeBatches: ["UG3", "UG4", "PG2"],
		};

		const preview = view.renderLocationDetailPreview(locationData, mockMessage);
		expect(preview).toContain("SEATING ALLOCATION PREVIEW");
		expect(preview).toContain("2026-10-08");
		expect(preview).toContain("Hostel Mess");
		expect(preview).toContain("UG1, UG2, PG1, PhD");
		expect(preview).toContain("College Mess");
		expect(preview).toContain("UG3, UG4, PG2");
		expect(preview).toContain("[y] Confirm & Commit");
		expect(preview).toContain("[d] Change Date");
		expect(preview).toContain("[e] Edit Batches in vim");
	});

	it("renders timing extension preview matching Spec 4.4", () => {
		const timingData: ExtractedTimingExtension = {
			mealDate: "2026-10-08",
			mealSlot: "dinner",
			targetVendor: null,
			extendedTimings: "Extended until 10:45 PM due to college fest",
		};

		const preview = view.renderTimingExtensionPreview(timingData, mockMessage);
		expect(preview).toContain("MEAL TIMING EXTENSION PREVIEW");
		expect(preview).toContain("2026-10-08");
		expect(preview).toContain("dinner");
		expect(preview).toContain("All Vendors (Global)");
		expect(preview).toContain("Extended until 10:45 PM due to college fest");
		expect(preview).toContain("[y] Confirm & Commit");
		expect(preview).toContain("[v] Assign to specific vendor");
	});

	it("renders meal change preview matching Spec 4.4", () => {
		const changeData: ExtractedMealChange = {
			mealDate: "2026-10-08",
			mealSlot: "lunch",
			targetVendor: "cheftalk_regular",
			changeType: "replacement",
			affectedItem: "Kadai Paneer",
			originalItem: "Paneer Butter Masala",
		};

		const preview = view.renderMealChangePreview(changeData, mockMessage);
		expect(preview).toContain("MEAL CHANGE / REPLACEMENT PREVIEW");
		expect(preview).toContain("2026-10-08");
		expect(preview).toContain("cheftalk_regular");
		expect(preview).toContain("REPLACEMENT");
		expect(preview).toContain("Paneer Butter Masala");
		expect(preview).toContain("Kadai Paneer");
		expect(preview).toContain("[y] Confirm & Commit");
		expect(preview).toContain("[t] Change Type");
	});

	it("renders ignore message preview matching Spec 4.4", () => {
		const preview = view.renderIgnorePreview(mockMessage);
		expect(preview).toContain("IGNORE STAGED MESSAGE");
		expect(preview).toContain("3EB0A1B2C3D4E5F6");
		expect(preview).toContain("[y] Confirm Ignore | [c] Cancel");
	});

	it("renders processed message actions undo card matching Spec 4.4", () => {
		const processedMsg: WhatsappGroupFoodAnnouncementsMessageRow = {
			...mockMessage,
			status: "processed",
			processedAt: new Date("2026-10-09T06:15:00.000Z"),
		};

		const card = view.renderProcessedMessageCard(processedMsg);
		expect(card).toContain("PROCESSED MESSAGE ACTIONS");
		expect(card).toContain("3EB0A1B2C3D4E5F6");
		expect(card).toContain("[u] Undo / Revert Ingestion");
		expect(card).toContain("[c] Cancel / Back to List");
	});

	it("renders with ANSI codes by default and stripAnsi strips them", () => {
		const ansiView = new TriageTerminalView();
		const table = ansiView.renderMessagesTable([mockMessage]);
		expect(table).toContain("\x1b[");
		const stripped = stripAnsi(table);
		expect(stripped).not.toContain("\x1b[");
		expect(stripped).toContain("3EB0A1B2C3D4E5F6");
	});

	it("renders composite announcement card with location, timing, and confirm action", () => {
		const card = view.renderCompositeAnnouncementCard({
			mealDate: "2026-10-20",
			location: {
				mealDate: "2026-10-20",
				mealSlot: "lunch",
				hostelBatches: ["2028", "2029"],
				collegeBatches: ["ALL_OTHER_BATCHES"],
			},
			timingExtensions: [
				{
					mealDate: "2026-10-20",
					mealSlot: "lunch",
					targetVendor: null,
					extendedTimings: "extended till 15:00",
				},
			],
			mealChanges: [],
			mealSwaps: [],
		});

		expect(card).toContain("Extracted Announcement Events (Date: 2026-10-20)");
		expect(card).toContain(
			"📍 Location: 2028, 2029 in Hostel | ALL_OTHER_BATCHES in College (Lunch)",
		);
		expect(card).toContain("⏰ Timing: Lunch extended till 15:00");
		expect(card).toContain("🔄 Changes: None");
		expect(card).toContain("🔁 Swaps: None");
		expect(card).toContain("Actions: [y] Confirm & Commit | [e] Edit in Neovim | [c] Cancel");
	});

	it("renders composite announcement card with resolved meal swaps", () => {
		const card = view.renderCompositeAnnouncementCard(
			{
				mealDate: "2026-10-20",
				location: null,
				timingExtensions: [],
				mealChanges: [],
				mealSwaps: [
					{
						targetMealDate: "2026-10-20",
						targetMealSlot: "dinner",
						sourceMealDate: "2026-10-21",
						sourceMealSlot: "lunch",
						targetVendor: "cheftalk_regular",
					},
				],
			},
			[
				{
					targetMealDate: "2026-10-20",
					targetMealSlot: "dinner",
					sourceMealDate: "2026-10-21",
					sourceMealSlot: "lunch",
					vendor: "cheftalk_regular",
					newItems: ["Rajma", "Jeera Rice", "Boondi Raita", "Roti", "Gulab Jamun"],
					previousItems: ["Dal Fry", "Roti"],
				},
			],
		);

		expect(card).toContain("🔁 Meal Swap: 2026-10-20 Dinner <- 2026-10-21 Lunch");
		expect(card).toContain(
			"Resolved Items (cheftalk_regular): [Rajma, Jeera Rice, Boondi Raita, Roti, Gulab Jamun]",
		);
		expect(card).toContain("[y] Confirm & Commit");
	});

	it("renders multi-vendor meal swap preview with each vendor explicitly identified", () => {
		const card = view.renderCompositeAnnouncementCard(
			{
				mealDate: "2026-10-20",
				location: null,
				timingExtensions: [],
				mealChanges: [],
				mealSwaps: [
					{
						targetMealDate: "2026-10-20",
						targetMealSlot: "dinner",
						sourceMealDate: "2026-10-21",
						sourceMealSlot: "lunch",
						targetVendor: null,
					},
				],
			},
			[
				{
					targetMealDate: "2026-10-20",
					targetMealSlot: "dinner",
					sourceMealDate: "2026-10-21",
					sourceMealSlot: "lunch",
					vendor: "cheftalk_regular",
					newItems: ["Paneer Butter Masala", "Roti"],
					previousItems: ["Dal Tadka", "Rice"],
				},
				{
					targetMealDate: "2026-10-20",
					targetMealSlot: "dinner",
					sourceMealDate: "2026-10-21",
					sourceMealSlot: "lunch",
					vendor: "cheftalk_jain",
					newItems: ["Jain Paneer", "Roti"],
					previousItems: ["Jain Dal", "Rice"],
				},
			],
		);

		expect(card).toContain("Resolved Items (cheftalk_regular): [Paneer Butter Masala, Roti]");
		expect(card).toContain("Resolved Items (cheftalk_jain): [Jain Paneer, Roti]");
	});

	it("renders composite announcement card with missing swaps blocking message (Option B gate)", () => {
		const card = view.renderCompositeAnnouncementCard(
			{
				mealDate: "2026-10-20",
				location: null,
				timingExtensions: [],
				mealChanges: [],
				mealSwaps: [
					{
						targetMealDate: "2026-10-20",
						targetMealSlot: "dinner",
						sourceMealDate: "2026-10-25",
						sourceMealSlot: "lunch",
						targetVendor: "cheftalk_regular",
					},
				],
			},
			[],
			[
				{
					targetMealDate: "2026-10-20",
					targetMealSlot: "dinner",
					sourceMealDate: "2026-10-25",
					sourceMealSlot: "lunch",
					targetVendor: "cheftalk_regular",
				},
			],
		);

		expect(card).toContain(
			"❌ Cannot Commit Swap: Source menu for 2026-10-25 Lunch not found in database. Please ingest that date's weekly menu before committing this announcement.",
		);
		expect(card).not.toContain("[y] Confirm & Commit");
		expect(card).toContain("Actions: [e] Edit in Neovim | [c] Cancel");
	});
});
