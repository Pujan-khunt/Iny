import { describe, it, expect } from "vitest";
import {
	isValidISODate,
	shiftISODate,
	getISTDateParts,
	getISTDateString,
	getISTMinutes,
	buildTemporallyGroundedSystemPrompt,
	formatHistoricalMessageTimeIST,
	formatDateISTNatural,
} from "../../../src/core/utils/Temporal";

describe("Temporal Utility", () => {
	describe("getISTDateParts", () => {
		it("extracts correct IST date parts from a UTC date", () => {
			// 09:00 UTC is 14:30 IST (+05:30)
			const date = new Date("2026-10-12T09:00:00.000Z");
			const parts = getISTDateParts(date);
			expect(parts).toEqual({
				year: 2026,
				month: 10,
				day: 12,
				hours: 14,
				minutes: 30,
			});
		});

		it("handles day rollover across UTC boundary", () => {
			// 20:00 UTC on 2026-10-12 is 01:30 IST on 2026-10-13
			const date = new Date("2026-10-12T20:00:00.000Z");
			const parts = getISTDateParts(date);
			expect(parts).toEqual({
				year: 2026,
				month: 10,
				day: 13,
				hours: 1,
				minutes: 30,
			});
		});

		it("handles year rollover across UTC boundary", () => {
			// 20:00 UTC on 2026-12-31 is 01:30 IST on 2027-01-01
			const date = new Date("2026-12-31T20:00:00.000Z");
			const parts = getISTDateParts(date);
			expect(parts).toEqual({
				year: 2027,
				month: 1,
				day: 1,
				hours: 1,
				minutes: 30,
			});
		});
	});

	describe("getISTDateString", () => {
		it("formats date into YYYY-MM-DD in IST", () => {
			const date = new Date("2026-10-12T09:00:00.000Z");
			expect(getISTDateString(date)).toBe("2026-10-12");
		});

		it("pads single-digit month and day with zero", () => {
			const date = new Date("2026-03-05T00:00:00.000Z"); // 05:30 IST on March 5
			expect(getISTDateString(date)).toBe("2026-03-05");
		});

		it("reflects the next day when UTC rolls over in IST", () => {
			const date = new Date("2026-10-12T20:00:00.000Z");
			expect(getISTDateString(date)).toBe("2026-10-13");
		});
	});

	describe("getISTMinutes", () => {
		it("calculates minutes since start of day in IST", () => {
			// 09:00 UTC is 14:30 IST -> 14 * 60 + 30 = 870
			const date = new Date("2026-10-12T09:00:00.000Z");
			expect(getISTMinutes(date)).toBe(870);
		});

		it("calculates minutes correctly for midnight / early morning", () => {
			// 18:35 UTC is 00:05 IST -> 0 * 60 + 5 = 5
			const date = new Date("2026-10-12T18:35:00.000Z");
			expect(getISTMinutes(date)).toBe(5);
		});
	});

	describe("buildTemporallyGroundedSystemPrompt", () => {
		it("injects formatted Date object in IST into base system prompt", () => {
			const date = new Date("2026-10-12T09:00:00.000Z");
			const basePrompt = "You are a campus dining assistant.";
			const groundedPrompt = buildTemporallyGroundedSystemPrompt(basePrompt, date);
			expect(groundedPrompt).toContain("You are a campus dining assistant.");
			expect(groundedPrompt).toContain("[Current Time (IST): ");
			expect(groundedPrompt).toContain("2026");
			expect(groundedPrompt).toContain("October");
			expect(groundedPrompt).toContain("12");
		});

		it("accepts timestamp number", () => {
			const date = new Date("2026-10-12T09:00:00.000Z");
			const groundedPrompt = buildTemporallyGroundedSystemPrompt("Prompt", date.getTime());
			expect(groundedPrompt).toContain("Prompt\n\n[Current Time (IST): ");
			expect(groundedPrompt).toContain("2026");
			expect(groundedPrompt).toContain("October");
			expect(groundedPrompt).toContain("12");
		});

		it("accepts ISO string", () => {
			const groundedPrompt = buildTemporallyGroundedSystemPrompt(
				"Prompt",
				"2026-10-12T09:00:00.000Z",
			);
			expect(groundedPrompt).toContain("Prompt\n\n[Current Time (IST): ");
			expect(groundedPrompt).toContain("2026");
			expect(groundedPrompt).toContain("October");
			expect(groundedPrompt).toContain("12");
		});

		it("defaults to current time if no parameter provided", () => {
			const basePrompt = "System instructions";
			const groundedPrompt = buildTemporallyGroundedSystemPrompt(basePrompt);
			expect(groundedPrompt).toContain("System instructions\n\n[Current Time (IST): ");
			expect(groundedPrompt.length).toBeGreaterThan(basePrompt.length);
		});
	});

	describe("formatHistoricalMessageTimeIST", () => {
		it("formats UTC date to deterministic YYYY-MM-DD HH:mm IST string", () => {
			// 2026-10-30 07:19:00 UTC = 2026-10-30 12:49:00 IST
			const utcDate = new Date("2026-10-30T07:19:00.000Z");
			expect(formatHistoricalMessageTimeIST(utcDate)).toBe("2026-10-30 12:49 IST");
		});

		it("pads single digit months, days, hours, and minutes with zeros", () => {
			// 2026-05-04 03:05:00 UTC = 2026-05-04 08:35:00 IST
			const utcDate = new Date("2026-05-04T03:05:00.000Z");
			expect(formatHistoricalMessageTimeIST(utcDate)).toBe("2026-05-04 08:35 IST");
		});
	});

	describe("formatDateISTNatural", () => {
		const refNow = new Date("2026-11-08T12:00:00.000Z"); // 2026-11-08 (Sunday) IST

		it("formats today with relative prefix and ordinal day", () => {
			expect(formatDateISTNatural("2026-11-08", refNow)).toBe("Today, Sunday, 8th Nov");
		});

		it("formats tomorrow with relative prefix and ordinal day", () => {
			expect(formatDateISTNatural("2026-11-09", refNow)).toBe("Tomorrow, Monday, 9th Nov");
		});

		it("formats yesterday with relative prefix and ordinal day", () => {
			expect(formatDateISTNatural("2026-11-07", refNow)).toBe("Yesterday, Saturday, 7th Nov");
		});

		it("formats distant dates without relative prefix", () => {
			expect(formatDateISTNatural("2026-11-13", refNow)).toBe("Friday, 13th Nov");
			expect(formatDateISTNatural("2026-11-15", refNow)).toBe("Sunday, 15th Nov");
		});

		it("correctly handles all ordinal endings (1st, 2nd, 3rd, 4th, 11th-13th, 21st-23rd, 31st)", () => {
			expect(formatDateISTNatural("2026-10-01", refNow)).toBe("Thursday, 1st Oct");
			expect(formatDateISTNatural("2026-10-02", refNow)).toBe("Friday, 2nd Oct");
			expect(formatDateISTNatural("2026-10-03", refNow)).toBe("Saturday, 3rd Oct");
			expect(formatDateISTNatural("2026-10-04", refNow)).toBe("Sunday, 4th Oct");
			expect(formatDateISTNatural("2026-10-11", refNow)).toBe("Sunday, 11th Oct");
			expect(formatDateISTNatural("2026-10-12", refNow)).toBe("Monday, 12th Oct");
			expect(formatDateISTNatural("2026-10-13", refNow)).toBe("Tuesday, 13th Oct");
			expect(formatDateISTNatural("2026-10-21", refNow)).toBe("Wednesday, 21st Oct");
			expect(formatDateISTNatural("2026-10-22", refNow)).toBe("Thursday, 22nd Oct");
			expect(formatDateISTNatural("2026-10-23", refNow)).toBe("Friday, 23rd Oct");
			expect(formatDateISTNatural("2026-10-31", refNow)).toBe("Saturday, 31st Oct");
		});

		it("defaults to current time if now parameter is omitted", () => {
			const result = formatDateISTNatural("2026-11-08");
			expect(typeof result).toBe("string");
			expect(result.length).toBeGreaterThan(0);
		});

		it("omits relative prefix when now is explicitly null", () => {
			expect(formatDateISTNatural("2026-11-08", null)).toBe("Sunday, 8th Nov");
		});
	});
});

describe("strict calendar dates", () => {
	it.each(["2024-02-29", "2000-02-29", "2026-11-01", "0099-01-01"])(
		"accepts the real ISO calendar date %s",
		(value) => {
			expect(isValidISODate(value)).toBe(true);
		},
	);
	it.each([
		"2026-02-29",
		"1900-02-29",
		"2026-11-31",
		"2026-00-01",
		"2026-13-01",
		"2026-01-00",
		"2026-1-01",
		"2026-01-1",
		"2026-11-01T00:00:00Z",
		" 2026-11-01",
		"nonsense",
	])("rejects the invalid ISO calendar date %s", (value) => {
		expect(isValidISODate(value)).toBe(false);
	});
	it.each([
		["2026-12-31", 1, "2027-01-01"],
		["2024-03-01", -1, "2024-02-29"],
		["2026-03-01", -1, "2026-02-28"],
		["2026-11-01", 0, "2026-11-01"],
		["0099-12-31", 1, "0100-01-01"],
	])("shifts %s by %s calendar days", (value, days, expected) => {
		expect(shiftISODate(value as string, days as number)).toBe(expected);
	});
	it.each(["2026-02-29", "2026-1-01", "not-a-date"])(
		"throws for invalid shift input %s",
		(value) => {
			expect(() => shiftISODate(value, 1)).toThrow(RangeError);
		},
	);
	it.each([0.5, NaN, Infinity])("throws for noninteger shift %s", (days) => {
		expect(() => shiftISODate("2026-11-01", days)).toThrow(RangeError);
	});
	it("throws when a shift leaves the four-digit ISO calendar", () => {
		expect(() => shiftISODate("9999-12-31", 1)).toThrow(RangeError);
	});
});
