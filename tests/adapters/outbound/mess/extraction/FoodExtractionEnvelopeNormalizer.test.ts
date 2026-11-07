import { describe, expect, it } from "vitest";
import { normalizeFoodExtractionEnvelope } from "../../../../../src/adapters/outbound/mess/extraction/FoodExtractionEnvelopeNormalizer";

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
});
