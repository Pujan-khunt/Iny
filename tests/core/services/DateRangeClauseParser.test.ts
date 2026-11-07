import { describe, expect, it } from "vitest";
import { validateDateRangeClause } from "../../../src/core/services/DateRangeClauseParser";

describe("DateRangeClauseParser", () => {
	const originalCreatedAt = new Date("2026-11-06T04:00:00Z");

	it("validates when target date is within from-to date range", () => {
		const clause =
			"Lunch will be arranged in the hostel from *6th November 2026 to 12th November 2026* on account of the Diwali holidays.";

		expect(validateDateRangeClause(clause, "2026-11-06", originalCreatedAt)).toBe(true);
		expect(validateDateRangeClause(clause, "2026-11-08", originalCreatedAt)).toBe(true);
		expect(validateDateRangeClause(clause, "2026-11-12", originalCreatedAt)).toBe(true);
	});

	it("validates numeric range formats (e.g. 1/11/2026 to 7/11/2026 or 1/11/26 - 7/11/26)", () => {
		const clause = "Food service altered from 1/11/2026 to 7/11/2026 in hostel.";

		expect(validateDateRangeClause(clause, "2026-11-01", originalCreatedAt)).toBe(true);
		expect(validateDateRangeClause(clause, "2026-11-05", originalCreatedAt)).toBe(true);
		expect(validateDateRangeClause(clause, "2026-11-07", originalCreatedAt)).toBe(true);
		expect(validateDateRangeClause(clause, "2026-11-08", originalCreatedAt)).toBe(false);
	});

	it("rejects when target date is before the start date", () => {
		const clause = "Lunch in hostel from 6th November 2026 to 12th November 2026.";
		expect(validateDateRangeClause(clause, "2026-11-05", originalCreatedAt)).toBe(false);
	});

	it("rejects when target date is after the end date", () => {
		const clause = "Lunch in hostel from 6th November 2026 to 12th November 2026.";
		expect(validateDateRangeClause(clause, "2026-11-13", originalCreatedAt)).toBe(false);
	});

	it("returns false for non-range clauses", () => {
		const clause = "Lunch will be arranged in the hostel today.";
		expect(validateDateRangeClause(clause, "2026-11-06", originalCreatedAt)).toBe(false);
	});

	it("rejects when start date is after end date (inverted range)", () => {
		const clause = "Lunch in hostel from 12th November 2026 to 6th November 2026.";
		expect(validateDateRangeClause(clause, "2026-11-08", originalCreatedAt)).toBe(false);
	});
});
