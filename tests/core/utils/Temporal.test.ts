import { describe, it, expect } from "vitest";
import {
	getISTDateParts,
	getISTDateString,
	getISTMinutes,
	buildTemporallyGroundedSystemPrompt,
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
});
