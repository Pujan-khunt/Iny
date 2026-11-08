import { describe, expect, it } from "vitest";
import { supplementLocationEvidence } from "../../../../../src/adapters/outbound/mess/extraction/LocationEvidenceSupplementer";

describe("LocationEvidenceSupplementer", () => {
	it("returns evidence untouched when candidate is null or has no locations", () => {
		const evidence = [{ fieldPath: "/some/path" }];
		expect(supplementLocationEvidence(null, evidence)).toBe(evidence);
		expect(supplementLocationEvidence({}, evidence)).toBe(evidence);
		expect(supplementLocationEvidence({ announcement: {} }, evidence)).toBe(evidence);
	});

	it("supplements missing mealSlot evidence from mealDate evidence when mealSlot is mentioned", () => {
		const candidate = {
			announcement: {
				locations: [
					{
						mealDate: "2026-11-06",
						mealSlot: "lunch",
						hostelBatches: ["ALL_BATCHES"],
						collegeBatches: [],
					},
				],
			},
		};
		const evidence = [
			{
				fieldPath: "/announcement/locations/0/mealDate",
				rawValue: "6th November 2026",
				clause: "Lunch will be arranged in hostel from 6th November 2026.",
				location: { kind: "text", start: 38, end: 55 },
			},
		];

		const result = supplementLocationEvidence(candidate, evidence) as any[];

		expect(result).toHaveLength(2);
		expect(result[1]).toEqual({
			fieldPath: "/announcement/locations/0/mealSlot",
			rawValue: "Lunch",
			clause: "Lunch will be arranged in hostel from 6th November 2026.",
			location: { kind: "text", start: 0, end: 5 },
		});
	});

	it("does not supplement when mealSlot evidence already exists", () => {
		const candidate = {
			announcement: {
				locations: [
					{
						mealDate: "2026-11-06",
						mealSlot: "lunch",
						hostelBatches: [],
						collegeBatches: [],
					},
				],
			},
		};
		const evidence = [
			{
				fieldPath: "/announcement/locations/0/mealDate",
				rawValue: "6th November 2026",
				clause: "Lunch in hostel",
				location: { kind: "text", start: 9, end: 26 },
			},
			{
				fieldPath: "/announcement/locations/0/mealSlot",
				rawValue: "Lunch",
				clause: "Lunch in hostel",
				location: { kind: "text", start: 0, end: 5 },
			},
		];

		const result = supplementLocationEvidence(candidate, evidence);
		expect(result).toBe(evidence);
	});

	it("does not supplement if mealDate evidence location is not text", () => {
		const candidate = {
			announcement: {
				locations: [{ mealDate: "2026-11-06", mealSlot: "lunch" }],
			},
		};
		const evidence = [
			{
				fieldPath: "/announcement/locations/0/mealDate",
				rawValue: "2026-11-06",
				clause: "Lunch",
				location: { kind: "image", page: 1, row: "1", column: "1" },
			},
		];

		const result = supplementLocationEvidence(candidate, evidence);
		expect(result).toBe(evidence);
	});
});
