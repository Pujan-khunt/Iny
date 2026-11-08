import { describe, expect, it } from "vitest";
import { normalizeFoodExtractionEnvelope } from "../../../../../src/adapters/outbound/mess/extraction/FoodExtractionEnvelopeNormalizer";
import { FoodExtractionSchema } from "../../../../../src/adapters/outbound/mess/extraction/FoodAssessmentSchemas";

describe("FoodExtractionEnvelopeNormalizer", () => {
	it("normalizes flattened operational announcement envelope", () => {
		const flattened = {
			kind: "operational_announcement",
			announcement: {
				locations: [],
				timings: [],
				changes: [],
				swaps: [],
			},
			evidence: [
				{
					fieldPath: "/announcement/locations/0/mealDate",
					rawValue: "6th November 2026",
					clause: "Lunch in hostel",
					location: { kind: "text", start: 0, end: 17 },
				},
			],
		};

		const normalized = normalizeFoodExtractionEnvelope(flattened);

		expect(normalized).toEqual({
			kind: "candidate",
			candidate: {
				kind: "operational_announcement",
				announcement: flattened.announcement,
			},
			evidence: flattened.evidence,
		});
	});

	it("normalizes flattened weekly menu envelope", () => {
		const flattened = {
			kind: "weekly_menu",
			dateRange: { start: "2026-11-01", end: "2026-11-07" },
			menu: { vendor: "tcb", meals: [] },
			evidence: [],
		};

		const normalized = normalizeFoodExtractionEnvelope(flattened);

		expect(normalized).toEqual({
			kind: "candidate",
			candidate: {
				kind: "weekly_menu",
				dateRange: flattened.dateRange,
				menu: flattened.menu,
			},
			evidence: [],
		});
	});

	it("passes through standard candidate envelope untouched", () => {
		const standard = {
			kind: "candidate",
			candidate: {
				kind: "operational_announcement",
				announcement: { locations: [], timings: [], changes: [], swaps: [] },
			},
			evidence: [],
		};

		expect(normalizeFoodExtractionEnvelope(standard)).toBe(standard);
	});

	it("aligns text evidence end offset with start + rawValue.length", () => {
		const unaligned = {
			kind: "candidate",
			candidate: {
				kind: "operational_announcement",
				announcement: { locations: [], timings: [], changes: [], swaps: [] },
			},
			evidence: [
				{
					fieldPath: "/announcement/locations/0/mealDate",
					rawValue: "6th November 2026 to 12th November 2026",
					clause:
						"📢 Lunch will be arranged in the hostel from *6th November 2026 to 12th November 2026*.",
					location: {
						kind: "text",
						start: 46,
						end: 84, // Off-by-one: 46 + 39 is 85
					},
				},
			],
		};

		const normalized = normalizeFoodExtractionEnvelope(unaligned) as any;
		expect(normalized.evidence[0].location.end).toBe(85);
	});

	it("passes through unsupported envelope untouched", () => {
		const unsupported = {
			kind: "unsupported",
			detail: "Only a greeting",
		};

		expect(normalizeFoodExtractionEnvelope(unsupported)).toBe(unsupported);
	});

	it("passes through uncertain envelope untouched", () => {
		const uncertain = {
			kind: "uncertain",
			detail: "Missing date",
		};

		expect(normalizeFoodExtractionEnvelope(uncertain)).toBe(uncertain);
	});

	it("safely passes through non-objects, null, and undefined", () => {
		expect(normalizeFoodExtractionEnvelope(null)).toBeNull();
		expect(normalizeFoodExtractionEnvelope(undefined)).toBeUndefined();
		expect(normalizeFoodExtractionEnvelope("random string")).toBe("random string");
		expect(normalizeFoodExtractionEnvelope(123)).toBe(123);
	});

	it("normalizes evidence entries with path to fieldPath and populates missing rawValue and clause", () => {
		const raw = {
			kind: "candidate",
			candidate: {
				kind: "weekly_menu",
				dateRange: { start: "2026-11-02", end: "2026-11-08" },
				menu: { vendor: "tcb", meals: [] },
			},
			evidence: [
				{
					path: "/dateRange/start",
					location: { kind: "image", page: 1, row: "Date", column: "Monday" },
				},
				{
					path: "/dateRange/end",
					location: { kind: "image", page: 1, row: "Date", column: "Sunday" },
				},
				{
					path: "/menu/vendor",
					location: { kind: "image", page: 1, row: "Header", column: "Vendor" },
				},
			],
		};

		const normalized = normalizeFoodExtractionEnvelope(raw) as any;

		expect(normalized.evidence).toEqual([
			{
				fieldPath: "/dateRange/start",
				rawValue: "2026-11-02",
				clause: "2026-11-02",
				location: { kind: "image", page: 1, row: "Date", column: "Monday" },
			},
			{
				fieldPath: "/dateRange/end",
				rawValue: "2026-11-08",
				clause: "2026-11-08",
				location: { kind: "image", page: 1, row: "Date", column: "Sunday" },
			},
			{
				fieldPath: "/menu/vendor",
				rawValue: "tcb",
				clause: "tcb",
				location: { kind: "image", page: 1, row: "Header", column: "Vendor" },
			},
		]);
		expect("path" in normalized.evidence[0]).toBe(false);
	});

	it("normalizes real-world TCB weekly menu LLM extraction output containing path and missing rawValue/clause into schema-valid candidate", () => {
		const meals = [
			{
				mealDate: "2026-11-02",
				mealSlot: "breakfast",
				items: ["Black Chana Dry", "Triangle Paratha"],
			},
			{ mealDate: "2026-11-02", mealSlot: "lunch", items: ["Mix Dal", "Aloo Matar Dry"] },
			{ mealDate: "2026-11-02", mealSlot: "dinner", items: ["Lauki Chana Dal", "Mix Veg"] },
			{ mealDate: "2026-11-03", mealSlot: "breakfast", items: ["Poha With Sev"] },
			{ mealDate: "2026-11-03", mealSlot: "lunch", items: ["Black Masoor"] },
			{ mealDate: "2026-11-03", mealSlot: "dinner", items: ["Dal Kolhapuri"] },
			{ mealDate: "2026-11-04", mealSlot: "breakfast", items: ["Uttapam"] },
			{ mealDate: "2026-11-04", mealSlot: "lunch", items: ["Panchrati Dal"] },
			{ mealDate: "2026-11-04", mealSlot: "dinner", items: ["Dal Tadka"] },
			{ mealDate: "2026-11-05", mealSlot: "breakfast", items: ["Macroni"] },
			{ mealDate: "2026-11-05", mealSlot: "lunch", items: ["Urad Chana Dal"] },
			{ mealDate: "2026-11-05", mealSlot: "dinner", items: ["Black Chana"] },
			{ mealDate: "2026-11-06", mealSlot: "breakfast", items: ["Vermicelli Upma"] },
			{ mealDate: "2026-11-06", mealSlot: "lunch", items: ["Dal Fry"] },
			{ mealDate: "2026-11-06", mealSlot: "dinner", items: ["Kadhi Pakoda 2pcs"] },
			{ mealDate: "2026-11-07", mealSlot: "breakfast", items: ["Masala Dosa"] },
			{ mealDate: "2026-11-07", mealSlot: "lunch", items: ["Chana Masala"] },
			{ mealDate: "2026-11-07", mealSlot: "dinner", items: ["Navratan Dal"] },
			{ mealDate: "2026-11-08", mealSlot: "breakfast", items: ["Aloo Paratha"] },
			{ mealDate: "2026-11-08", mealSlot: "lunch", items: ["Dal Makhani"] },
			{ mealDate: "2026-11-08", mealSlot: "dinner", items: ["Paneer Butter Masala"] },
		];

		const raw = {
			kind: "candidate",
			candidate: {
				kind: "weekly_menu",
				dateRange: { start: "2026-11-02", end: "2026-11-08" },
				menu: { vendor: "tcb", meals },
			},
			evidence: [
				{
					path: "/dateRange/start",
					location: { kind: "image", page: 1, row: "Date", column: "Monday" },
				},
				{
					path: "/dateRange/end",
					location: { kind: "image", page: 1, row: "Date", column: "Sunday" },
				},
				{
					path: "/menu/vendor",
					location: { kind: "image", page: 1, row: "Header", column: "Vendor" },
				},
			],
		};

		const normalized = normalizeFoodExtractionEnvelope(raw);
		const parseResult = FoodExtractionSchema.safeParse(normalized);

		expect(parseResult.success).toBe(true);
	});
});
