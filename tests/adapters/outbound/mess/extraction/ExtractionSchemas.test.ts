import { describe, it, expect } from "vitest";
import {
	ExtractedWeeklyMenuSchema,
	ExtractedLocationDetailSchema,
	ExtractedTimingExtensionSchema,
	ExtractedMealChangeSchema,
	ExtractedMealSwapSchema,
	ExtractedCompositeAnnouncementSchema,
} from "../../../../../src/adapters/outbound/mess/extraction/ExtractionSchemas.js";

describe("Extraction Schemas", () => {
	describe("ExtractedWeeklyMenuSchema", () => {
		it("validates 21 meal slots with strict ISO date format", () => {
			const invalidDates = {
				vendor: "cheftalk_regular",
				meals: Array.from({ length: 21 }, () => ({
					mealDate: "04/10/2026", // Invalid format
					mealSlot: "breakfast",
					items: ["Poha"],
				})),
			};
			expect(() => ExtractedWeeklyMenuSchema.parse(invalidDates)).toThrow();

			const valid = {
				vendor: "cheftalk_regular",
				meals: Array.from({ length: 21 }, (_, i) => ({
					mealDate: `2026-10-${String(4 + Math.floor(i / 3)).padStart(2, "0")}`,
					mealSlot: ["breakfast", "lunch", "dinner"][i % 3],
					items: ["Poha"],
				})),
			};
			expect(ExtractedWeeklyMenuSchema.parse(valid)).toBeDefined();
		});

		it("rejects arrays with not exactly 21 meals", () => {
			const twentyMeals = {
				vendor: "cheftalk_regular",
				meals: Array.from({ length: 20 }, (_, i) => ({
					mealDate: "2026-10-04",
					mealSlot: ["breakfast", "lunch", "dinner"][i % 3],
					items: ["Poha"],
				})),
			};
			expect(() => ExtractedWeeklyMenuSchema.parse(twentyMeals)).toThrow();

			const twentyTwoMeals = {
				vendor: "cheftalk_regular",
				meals: Array.from({ length: 22 }, (_, i) => ({
					mealDate: "2026-10-04",
					mealSlot: ["breakfast", "lunch", "dinner"][i % 3],
					items: ["Poha"],
				})),
			};
			expect(() => ExtractedWeeklyMenuSchema.parse(twentyTwoMeals)).toThrow();
		});

		it("rejects invalid meal slots and invalid vendors", () => {
			const invalidSlot = {
				vendor: "cheftalk_regular",
				meals: Array.from({ length: 21 }, () => ({
					mealDate: "2026-10-04",
					mealSlot: "snacks",
					items: ["Samosa"],
				})),
			};
			expect(() => ExtractedWeeklyMenuSchema.parse(invalidSlot)).toThrow();

			const invalidVendor = {
				vendor: "unknown_vendor",
				meals: Array.from({ length: 21 }, (_, i) => ({
					mealDate: "2026-10-04",
					mealSlot: ["breakfast", "lunch", "dinner"][i % 3],
					items: ["Poha"],
				})),
			};
			expect(() => ExtractedWeeklyMenuSchema.parse(invalidVendor)).toThrow();
		});

		it("rejects empty items array or empty item strings", () => {
			const emptyItems = {
				vendor: "tcb",
				meals: Array.from({ length: 21 }, () => ({
					mealDate: "2026-10-04",
					mealSlot: "breakfast",
					items: [],
				})),
			};
			expect(() => ExtractedWeeklyMenuSchema.parse(emptyItems)).toThrow();

			const emptyItemString = {
				vendor: "tcb",
				meals: Array.from({ length: 21 }, () => ({
					mealDate: "2026-10-04",
					mealSlot: "breakfast",
					items: [""],
				})),
			};
			expect(() => ExtractedWeeklyMenuSchema.parse(emptyItemString)).toThrow();
		});
	});

	describe("ExtractedLocationDetailSchema", () => {
		it("validates location details and defaults mealSlot to lunch", () => {
			const input = {
				mealDate: "2026-10-08",
				hostelBatches: ["UG1", "UG2", "PG1"],
				collegeBatches: ["UG3", "UG4"],
			};
			const parsed = ExtractedLocationDetailSchema.parse(input);
			expect(parsed.mealSlot).toBe("lunch");
			expect(parsed.hostelBatches).toEqual(["UG1", "UG2", "PG1"]);
			expect(parsed.collegeBatches).toEqual(["UG3", "UG4"]);
		});

		it("allows specifying custom mealSlot", () => {
			const input = {
				mealDate: "2026-10-08",
				mealSlot: "dinner",
				hostelBatches: [],
				collegeBatches: ["UG1"],
			};
			const parsed = ExtractedLocationDetailSchema.parse(input);
			expect(parsed.mealSlot).toBe("dinner");
		});

		it("rejects invalid mealDate", () => {
			expect(() =>
				ExtractedLocationDetailSchema.parse({
					mealDate: "08/10/2026",
					hostelBatches: [],
					collegeBatches: [],
				}),
			).toThrow();
		});
	});

	describe("ExtractedTimingExtensionSchema", () => {
		it("validates timing extension with targetVendor", () => {
			const input = {
				mealDate: "2026-10-08",
				mealSlot: "dinner",
				targetVendor: "cheftalk_regular",
				extendedTimings: "Extended until 10:45 PM due to fest",
			};
			const parsed = ExtractedTimingExtensionSchema.parse(input);
			expect(parsed.targetVendor).toBe("cheftalk_regular");
			expect(parsed.extendedTimings).toContain("10:45 PM");
		});

		it("allows nullable targetVendor for global extensions", () => {
			const input = {
				mealDate: "2026-10-08",
				mealSlot: "dinner",
				targetVendor: null,
				extendedTimings: "Extended till 11:00 PM for all messes",
			};
			const parsed = ExtractedTimingExtensionSchema.parse(input);
			expect(parsed.targetVendor).toBeNull();
		});

		it("rejects invalid mealSlot or invalid mealDate", () => {
			expect(() =>
				ExtractedTimingExtensionSchema.parse({
					mealDate: "2026-10-08",
					mealSlot: "tea",
					targetVendor: null,
					extendedTimings: "Extended",
				}),
			).toThrow();

			expect(() =>
				ExtractedTimingExtensionSchema.parse({
					mealDate: "October 8",
					mealSlot: "lunch",
					targetVendor: null,
					extendedTimings: "Extended",
				}),
			).toThrow();
		});
	});

	describe("ExtractedMealChangeSchema", () => {
		it("validates replacement meal change", () => {
			const input = {
				mealDate: "2026-10-08",
				mealSlot: "lunch",
				targetVendor: "cheftalk_regular",
				changeType: "replacement",
				affectedItem: "Kadai Paneer",
				originalItem: "Paneer Butter Masala",
			};
			const parsed = ExtractedMealChangeSchema.parse(input);
			expect(parsed.changeType).toBe("replacement");
			expect(parsed.affectedItem).toBe("Kadai Paneer");
			expect(parsed.originalItem).toBe("Paneer Butter Masala");
		});

		it("validates addition meal change with null originalItem", () => {
			const input = {
				mealDate: "2026-10-08",
				mealSlot: "dinner",
				targetVendor: "tcb",
				changeType: "addition",
				affectedItem: "Ice Cream",
				originalItem: null,
			};
			const parsed = ExtractedMealChangeSchema.parse(input);
			expect(parsed.changeType).toBe("addition");
			expect(parsed.originalItem).toBeNull();
		});

		it("rejects invalid changeType", () => {
			expect(() =>
				ExtractedMealChangeSchema.parse({
					mealDate: "2026-10-08",
					mealSlot: "lunch",
					targetVendor: "cheftalk_regular",
					changeType: "modification",
					affectedItem: "Kadai Paneer",
				}),
			).toThrow();
		});
	});

	describe("ExtractedMealSwapSchema", () => {
		it("validates a correct one-way meal swap", () => {
			const valid = {
				targetMealDate: "2026-10-20",
				targetMealSlot: "dinner",
				sourceMealDate: "2026-10-21",
				sourceMealSlot: "lunch",
				targetVendor: "cheftalk_regular",
			};
			const parsed = ExtractedMealSwapSchema.parse(valid);
			expect(parsed.targetMealSlot).toBe("dinner");
			expect(parsed.sourceMealSlot).toBe("lunch");
		});

		it("allows targetVendor to be null or undefined (applies to all vendors)", () => {
			const valid = {
				targetMealDate: "2026-10-20",
				targetMealSlot: "dinner",
				sourceMealDate: "2026-10-21",
				sourceMealSlot: "lunch",
				targetVendor: null,
			};
			const parsed = ExtractedMealSwapSchema.parse(valid);
			expect(parsed.targetVendor).toBeNull();
		});

		it("rejects invalid dates or slot names", () => {
			expect(() =>
				ExtractedMealSwapSchema.parse({
					targetMealDate: "20-10-2026",
					targetMealSlot: "snacks",
					sourceMealDate: "2026-10-21",
					sourceMealSlot: "lunch",
				}),
			).toThrow();
		});
	});

	describe("ExtractedCompositeAnnouncementSchema", () => {
		it("validates a composite announcement with all event types present", () => {
			const payload = {
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
						extendedTimings: "Extended till 15:00",
					},
				],
				mealChanges: [
					{
						mealDate: "2026-10-20",
						mealSlot: "lunch",
						targetVendor: "cheftalk_regular",
						changeType: "replacement",
						affectedItem: "Kadhai Paneer",
						originalItem: "Paneer Butter Masala",
					},
				],
				mealSwaps: [
					{
						targetMealDate: "2026-10-20",
						targetMealSlot: "dinner",
						sourceMealDate: "2026-10-21",
						sourceMealSlot: "lunch",
					},
				],
			};
			const result = ExtractedCompositeAnnouncementSchema.parse(payload);
			expect(result.location?.hostelBatches).toEqual(["2028", "2029"]);
			expect(result.timingExtensions).toHaveLength(1);
			expect(result.mealChanges).toHaveLength(1);
			expect(result.mealSwaps).toHaveLength(1);
		});

		it("provides safe defaults for empty arrays and null location", () => {
			const minimal = {
				mealDate: "2026-10-20",
			};
			const result = ExtractedCompositeAnnouncementSchema.parse(minimal);
			expect(result.mealDate).toBe("2026-10-20");
			expect(result.location).toBeUndefined();
			expect(result.timingExtensions).toEqual([]);
			expect(result.mealChanges).toEqual([]);
			expect(result.mealSwaps).toEqual([]);
		});
	});
});
