import { describe, it, expect } from "vitest";
import {
	renderMultiVendorSlotDigest,
	renderSingleVendorSlotDetail,
	renderSingleVendorFullDayDigest,
	sanitizeWhatsAppText,
	formatCardHeader,
	renderActiveUpdatesBanner,
	renderTimingExtensionsSection,
	renderLocationSection,
} from "../../../../../src/adapters/outbound/mess/formatting/MessCardRenderer.js";
import { ResolvedMealInfo, MessMeal } from "../../../../../src/core/entities/MessMeal.js";

describe("MessCardRenderer & WhatsApp Formatting", () => {
	describe("sanitizeWhatsAppText", () => {
		it("sanitizes markdown headers and bullets to WhatsApp bold", () => {
			const raw = "### Title\n**Bold Text**\n- Bullet 1";
			const clean = sanitizeWhatsAppText(raw);
			expect(clean).not.toContain("###");
			expect(clean).not.toContain("**");
			expect(clean).toContain("*Bold Text*");
		});

		it("cleans rogue characters and underscores without breaking formatting", () => {
			const raw = "Paneer_Butter_Masala with `special` spices ~garnished~";
			const clean = sanitizeWhatsAppText(raw);
			expect(clean).toBe("Paneer Butter Masala with special spices garnished");
		});
	});

	describe("renderLocationSection", () => {
		it("strictly omits location details if locationDetail is null", () => {
			expect(renderLocationSection(null)).toBeNull();
		});

		it("renders all in college when hostelBatches is empty", () => {
			const detail = {
				id: "loc-1",
				mealDate: "2026-10-08",
				mealSlot: "lunch" as const,
				hostelBatches: [],
				collegeBatches: ["ALL_BATCHES"],
				ingestedAt: new Date(),
			};
			const rendered = renderLocationSection(detail);
			expect(rendered).toBe("📍 *Location:* College (All batches)");
		});

		it("renders all in hostel when collegeBatches is empty", () => {
			const detail = {
				id: "loc-2",
				mealDate: "2026-10-08",
				mealSlot: "lunch" as const,
				hostelBatches: ["ALL_BATCHES"],
				collegeBatches: [],
				ingestedAt: new Date(),
			};
			const rendered = renderLocationSection(detail);
			expect(rendered).toBe("📍 *Location:* Hostel (All batches)");
		});

		it("renders split seating when both have batches", () => {
			const detail = {
				id: "loc-3",
				mealDate: "2026-10-08",
				mealSlot: "lunch" as const,
				hostelBatches: ["2027", "2028", "2029 A"],
				collegeBatches: ["ALL_OTHER_BATCHES"],
				ingestedAt: new Date(),
			};
			const rendered = renderLocationSection(detail);
			expect(rendered).toBe(
				"📍 *Location:*\n• *Hostel:* Batches 2027, 2028, 2029 A\n• *College:* All other batches",
			);
		});

		it("renders Lunch Location prefix when isFullDay is true", () => {
			const detail = {
				id: "loc-4",
				mealDate: "2026-10-08",
				mealSlot: "lunch" as const,
				hostelBatches: [],
				collegeBatches: ["ALL_BATCHES"],
				ingestedAt: new Date(),
			};
			const rendered = renderLocationSection(detail, true);
			expect(rendered).toBe("📍 *Lunch Location:* College (All batches)");
		});
	});

	describe("renderActiveUpdatesBanner", () => {
		it("returns null when changes array is empty", () => {
			expect(renderActiveUpdatesBanner([])).toBeNull();
		});

		it("renders replacement change correctly", () => {
			const changes = [
				{
					id: "c-1",
					mealDate: "2026-10-08",
					mealSlot: "lunch" as const,
					targetVendor: "cheftalk_regular" as const,
					changeType: "replacement" as const,
					affectedItem: "Kadai Paneer",
					originalItem: "Paneer Butter Masala",
					ingestedAt: new Date(),
				},
			];
			const banner = renderActiveUpdatesBanner(changes);
			expect(banner).toBe(
				"📢 *Active Updates:* Kadai Paneer replacing Paneer Butter Masala at Cheftalk Regular",
			);
		});

		it("renders addition and cancellation changes", () => {
			const changes = [
				{
					id: "c-2",
					mealDate: "2026-10-08",
					mealSlot: "lunch" as const,
					targetVendor: "tcb" as const,
					changeType: "addition" as const,
					affectedItem: "Ice Cream",
					originalItem: null,
					ingestedAt: new Date(),
				},
			];
			const banner = renderActiveUpdatesBanner(changes);
			expect(banner).toBe("📢 *Active Updates:* Ice Cream added at TCB (Uniworld)");
		});
	});

	describe("renderTimingExtensionsSection", () => {
		it("returns null when extensions array is empty", () => {
			expect(renderTimingExtensionsSection([])).toBeNull();
		});

		it("renders global timing extension", () => {
			const extensions = [
				{
					id: "ext-1",
					mealDate: "2026-10-08",
					mealSlot: "dinner" as const,
					targetVendor: null,
					extendedTimings: "Extended till 11:00 PM (Cultural Fest)",
					ingestedAt: new Date(),
				},
			];
			const section = renderTimingExtensionsSection(extensions);
			expect(section).toBe("⏰ *Timings:* Extended till 11:00 PM (Cultural Fest)");
		});
	});

	describe("formatCardHeader", () => {
		it("formats normal header with short weekday and day month", () => {
			const header = formatCardHeader("Lunch Menu", "2026-10-07", false);
			expect(header).toBe("🍽️ *Lunch Menu* (Wed, 7 Oct)");
		});

		it("formats ended header with *(Ended)* tag", () => {
			const header = formatCardHeader("Lunch Menu", "2026-10-07", true);
			expect(header).toBe("🍽️ *Lunch Menu* *(Ended)* (Wed, 7 Oct)");
		});
	});

	describe("renderMultiVendorSlotDigest (Q1 / Q3)", () => {
		const mockMeals: MessMeal[] = [
			{
				id: "m-1",
				mealDate: "2026-10-07",
				mealSlot: "lunch",
				vendor: "cheftalk_regular",
				items: ["Rajma Masala", "Jeera Rice", "Roti", "Boondi Raita"],
				ingestedAt: new Date(),
			},
			{
				id: "m-2",
				mealDate: "2026-10-07",
				mealSlot: "lunch",
				vendor: "cheftalk_jain",
				items: ["Yellow Dal", "Jeera Rice", "Roti", "Cucumber Raita"],
				ingestedAt: new Date(),
			},
			{
				id: "m-3",
				mealDate: "2026-10-07",
				mealSlot: "lunch",
				vendor: "tcb",
				items: ["Chole Bhature", "Veg Pulao", "Gulab Jamun"],
				ingestedAt: new Date(),
			},
		];

		it("strictly omits location details if locationDetail is null", () => {
			const mockInfo: ResolvedMealInfo = {
				mealDate: "2026-10-08",
				mealSlot: "lunch",
				meals: [],
				locationDetail: null,
				timingExtensions: [],
				mealChanges: [],
			};
			const rendered = renderMultiVendorSlotDigest(mockInfo, false);
			expect(rendered).not.toContain("Seating:");
			expect(rendered).not.toContain("Hostel");
			expect(rendered).not.toContain("College");
		});

		it("renders (Ended) tag when meal has ended", () => {
			const mockInfo: ResolvedMealInfo = {
				mealDate: "2026-10-08",
				mealSlot: "lunch",
				meals: [],
				locationDetail: null,
				timingExtensions: [],
				mealChanges: [],
			};
			const rendered = renderMultiVendorSlotDigest(mockInfo, true);
			expect(rendered).toContain("*(Ended)*");
		});

		it("renders full multi-vendor slot digest matching Section 7.4 spec reference", () => {
			const mockInfo: ResolvedMealInfo = {
				mealDate: "2026-10-07",
				mealSlot: "lunch",
				meals: mockMeals,
				locationDetail: {
					id: "loc-1",
					mealDate: "2026-10-07",
					mealSlot: "lunch",
					hostelBatches: [],
					collegeBatches: ["ALL_BATCHES"],
					ingestedAt: new Date(),
				},
				timingExtensions: [],
				mealChanges: [],
			};

			const rendered = renderMultiVendorSlotDigest(mockInfo, false);
			expect(rendered).toBe(
				"🍽️ *Lunch Menu* (Wed, 7 Oct)\n\n" +
					"🍛 *Cheftalk Regular:* Rajma Masala, Jeera Rice, Roti, Boondi Raita\n" +
					"🥗 *Cheftalk Jain:* Yellow Dal, Jeera Rice, Roti, Cucumber Raita\n" +
					"☕ *TCB (Uniworld):* Chole Bhature, Veg Pulao, Gulab Jamun\n\n" +
					"📍 *Location:* College (All batches)",
			);
		});

		it("omits location section for breakfast or dinner even if locationDetail is present", () => {
			const mockInfo: ResolvedMealInfo = {
				mealDate: "2026-10-07",
				mealSlot: "dinner",
				meals: mockMeals,
				locationDetail: {
					id: "loc-1",
					mealDate: "2026-10-07",
					mealSlot: "lunch",
					hostelBatches: [],
					collegeBatches: ["ALL_BATCHES"],
					ingestedAt: new Date(),
				},
				timingExtensions: [],
				mealChanges: [],
			};

			const rendered = renderMultiVendorSlotDigest(mockInfo, false);
			expect(rendered).not.toContain("📍 *Location:*");
		});
	});

	describe("renderSingleVendorSlotDetail (Q2)", () => {
		it("renders vertical bullet list of dishes for the vendor", () => {
			const mockInfo: ResolvedMealInfo = {
				mealDate: "2026-10-07",
				mealSlot: "lunch",
				meals: [
					{
						id: "m-1",
						mealDate: "2026-10-07",
						mealSlot: "lunch",
						vendor: "cheftalk_regular",
						items: [
							"Rajma Masala",
							"Jeera Rice",
							"Butter Roti",
							"Boondi Raita",
							"Green Salad",
							"Mixed Pickle",
						],
						ingestedAt: new Date(),
					},
				],
				locationDetail: {
					id: "loc-1",
					mealDate: "2026-10-07",
					mealSlot: "lunch",
					hostelBatches: [],
					collegeBatches: ["ALL_BATCHES"],
					ingestedAt: new Date(),
				},
				timingExtensions: [],
				mealChanges: [],
			};

			const rendered = renderSingleVendorSlotDetail(mockInfo, "cheftalk_regular", false);
			expect(rendered).toBe(
				"🍽️ *Lunch — Cheftalk Regular* (Wed, 7 Oct)\n\n" +
					"• Rajma Masala\n" +
					"• Jeera Rice\n" +
					"• Butter Roti\n" +
					"• Boondi Raita\n" +
					"• Green Salad\n" +
					"• Mixed Pickle\n\n" +
					"📍 *Location:* College (All batches)",
			);
		});

		it("renders (Ended) tag on single-vendor slot detail when ended", () => {
			const mockInfo: ResolvedMealInfo = {
				mealDate: "2026-10-07",
				mealSlot: "lunch",
				meals: [
					{
						id: "m-1",
						mealDate: "2026-10-07",
						mealSlot: "lunch",
						vendor: "cheftalk_regular",
						items: ["Rajma Masala"],
						ingestedAt: new Date(),
					},
				],
				locationDetail: null,
				timingExtensions: [],
				mealChanges: [],
			};

			const rendered = renderSingleVendorSlotDetail(mockInfo, "cheftalk_regular", true);
			expect(rendered).toContain("*(Ended)*");
		});
	});

	describe("renderSingleVendorFullDayDigest (Q4)", () => {
		const mockInfo: ResolvedMealInfo = {
			mealDate: "2026-10-07",
			mealSlot: null,
			meals: [
				{
					id: "m-1",
					mealDate: "2026-10-07",
					mealSlot: "breakfast",
					vendor: "tcb",
					items: ["Poha", "Jalebi", "Mint Chutney", "Tea / Coffee"],
					ingestedAt: new Date(),
				},
				{
					id: "m-2",
					mealDate: "2026-10-07",
					mealSlot: "lunch",
					vendor: "tcb",
					items: ["Chole Bhature", "Veg Pulao", "Curd", "Gulab Jamun"],
					ingestedAt: new Date(),
				},
				{
					id: "m-3",
					mealDate: "2026-10-07",
					mealSlot: "dinner",
					vendor: "tcb",
					items: ["Veg Biryani", "Mirchi Salan", "Raita", "Ice Cream"],
					ingestedAt: new Date(),
				},
			],
			locationDetail: {
				id: "loc-1",
				mealDate: "2026-10-07",
				mealSlot: "lunch",
				hostelBatches: [],
				collegeBatches: ["ALL_BATCHES"],
				ingestedAt: new Date(),
			},
			timingExtensions: [],
			mealChanges: [],
		};

		it("renders single-vendor full day menu with Breakfast, Lunch, Dinner and Lunch Location", () => {
			// 08:00 AM IST on 2026-10-07 (before breakfast cutoff)
			const morningIST = new Date("2026-10-07T02:30:00Z");
			const rendered = renderSingleVendorFullDayDigest(mockInfo, "tcb", morningIST);

			expect(rendered).toBe(
				"🍽️ *TCB (Uniworld) — Full Day Menu* (Wed, 7 Oct)\n\n" +
					"🌅 *Breakfast:* Poha, Jalebi, Mint Chutney, Tea / Coffee\n" +
					"🍛 *Lunch:* Chole Bhature, Veg Pulao, Curd, Gulab Jamun\n" +
					"🌙 *Dinner:* Veg Biryani, Mirchi Salan, Raita, Ice Cream\n\n" +
					"📍 *Lunch Location:* College (All batches)",
			);
		});

		it("evaluates each slot independently for (Ended) tag", () => {
			// 01:00 PM IST on 2026-10-07 (breakfast ended, lunch ongoing)
			const afternoonIST = new Date("2026-10-07T07:30:00Z");
			const rendered = renderSingleVendorFullDayDigest(mockInfo, "tcb", afternoonIST);

			expect(rendered).toContain(
				"🌅 *Breakfast* *(Ended):* Poha, Jalebi, Mint Chutney, Tea / Coffee",
			);
			expect(rendered).toContain("🍛 *Lunch:* Chole Bhature, Veg Pulao, Curd, Gulab Jamun");
			expect(rendered).toContain("🌙 *Dinner:* Veg Biryani, Mirchi Salan, Raita, Ice Cream");
		});
	});
});
