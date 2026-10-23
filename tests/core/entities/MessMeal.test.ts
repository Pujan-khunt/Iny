import { describe, it, expect } from "vitest";
import { isMealEnded, determineNextUpcomingSlot } from "../../../src/core/entities/MessMeal";

describe("MessMeal Domain & Time Helpers", () => {
	describe("isMealEnded", () => {
		it("determines isMealEnded correctly based on IST cutoffs", () => {
			// 2026-10-08 14:31:00 IST -> Lunch ended
			const postLunchTime = new Date("2026-10-08T09:01:00Z"); // 14:31 IST
			expect(isMealEnded("2026-10-08", "lunch", postLunchTime)).toBe(true);

			// 2026-10-08 14:29:00 IST -> Lunch ongoing
			const preLunchTime = new Date("2026-10-08T08:59:00Z"); // 14:29 IST
			expect(isMealEnded("2026-10-08", "lunch", preLunchTime)).toBe(false);

			// 2026-10-08 14:30:00 IST -> Exactly lunch cutoff -> not ended
			const exactLunchCutoff = new Date("2026-10-08T09:00:00Z"); // 14:30 IST
			expect(isMealEnded("2026-10-08", "lunch", exactLunchCutoff)).toBe(false);

			// Past date -> always ended
			expect(isMealEnded("2026-10-07", "dinner", postLunchTime)).toBe(true);

			// Future date -> not ended
			expect(isMealEnded("2026-10-09", "breakfast", postLunchTime)).toBe(false);
		});

		it("validates breakfast and dinner cutoffs", () => {
			// Breakfast cutoff: 09:30 IST
			const preBreakfast = new Date("2026-10-08T03:59:00Z"); // 09:29 IST
			const exactBreakfast = new Date("2026-10-08T04:00:00Z"); // 09:30 IST
			const postBreakfast = new Date("2026-10-08T04:01:00Z"); // 09:31 IST

			expect(isMealEnded("2026-10-08", "breakfast", preBreakfast)).toBe(false);
			expect(isMealEnded("2026-10-08", "breakfast", exactBreakfast)).toBe(false);
			expect(isMealEnded("2026-10-08", "breakfast", postBreakfast)).toBe(true);

			// Dinner cutoff: 21:30 IST
			const preDinner = new Date("2026-10-08T15:59:00Z"); // 21:29 IST
			const exactDinner = new Date("2026-10-08T16:00:00Z"); // 21:30 IST
			const postDinner = new Date("2026-10-08T16:01:00Z"); // 21:31 IST

			expect(isMealEnded("2026-10-08", "dinner", preDinner)).toBe(false);
			expect(isMealEnded("2026-10-08", "dinner", exactDinner)).toBe(false);
			expect(isMealEnded("2026-10-08", "dinner", postDinner)).toBe(true);
		});
	});

	describe("determineNextUpcomingSlot", () => {
		it("determines next upcoming slot with rollover", () => {
			// 21:31 IST -> rolls over to tomorrow breakfast
			const postDinner = new Date("2026-10-08T16:01:00Z"); // 21:31 IST
			const next = determineNextUpcomingSlot(postDinner);
			expect(next.mealDate).toBe("2026-10-09");
			expect(next.mealSlot).toBe("breakfast");
		});

		it("resolves breakfast before 09:30 IST on same day", () => {
			const earlyMorning = new Date("2026-10-08T02:30:00Z"); // 08:00 IST
			const nextEarly = determineNextUpcomingSlot(earlyMorning);
			expect(nextEarly.mealDate).toBe("2026-10-08");
			expect(nextEarly.mealSlot).toBe("breakfast");

			const exactCutoff = new Date("2026-10-08T04:00:00Z"); // 09:30 IST
			const nextExact = determineNextUpcomingSlot(exactCutoff);
			expect(nextExact.mealDate).toBe("2026-10-08");
			expect(nextExact.mealSlot).toBe("breakfast");
		});

		it("resolves lunch between 09:31 IST and 14:30 IST on same day", () => {
			const justAfterBreakfast = new Date("2026-10-08T04:01:00Z"); // 09:31 IST
			const nextAfterBf = determineNextUpcomingSlot(justAfterBreakfast);
			expect(nextAfterBf.mealDate).toBe("2026-10-08");
			expect(nextAfterBf.mealSlot).toBe("lunch");

			const midday = new Date("2026-10-08T06:30:00Z"); // 12:00 IST
			const nextMid = determineNextUpcomingSlot(midday);
			expect(nextMid.mealDate).toBe("2026-10-08");
			expect(nextMid.mealSlot).toBe("lunch");

			const exactLunchCutoff = new Date("2026-10-08T09:00:00Z"); // 14:30 IST
			const nextExactLunch = determineNextUpcomingSlot(exactLunchCutoff);
			expect(nextExactLunch.mealDate).toBe("2026-10-08");
			expect(nextExactLunch.mealSlot).toBe("lunch");
		});

		it("resolves dinner between 14:31 IST and 21:30 IST on same day", () => {
			const justAfterLunch = new Date("2026-10-08T09:01:00Z"); // 14:31 IST
			const nextAfterLunch = determineNextUpcomingSlot(justAfterLunch);
			expect(nextAfterLunch.mealDate).toBe("2026-10-08");
			expect(nextAfterLunch.mealSlot).toBe("dinner");

			const evening = new Date("2026-10-08T14:30:00Z"); // 20:00 IST
			const nextEvening = determineNextUpcomingSlot(evening);
			expect(nextEvening.mealDate).toBe("2026-10-08");
			expect(nextEvening.mealSlot).toBe("dinner");

			const exactDinnerCutoff = new Date("2026-10-08T16:00:00Z"); // 21:30 IST
			const nextExactDinner = determineNextUpcomingSlot(exactDinnerCutoff);
			expect(nextExactDinner.mealDate).toBe("2026-10-08");
			expect(nextExactDinner.mealSlot).toBe("dinner");
		});

		it("handles month-end and year-end rollover correctly", () => {
			// Month-end rollover: 2026-10-31 21:35 IST
			const monthEnd = new Date("2026-10-31T16:05:00Z");
			const nextMonth = determineNextUpcomingSlot(monthEnd);
			expect(nextMonth.mealDate).toBe("2026-11-01");
			expect(nextMonth.mealSlot).toBe("breakfast");

			// Year-end rollover: 2026-12-31 22:00 IST
			const yearEnd = new Date("2026-12-31T16:30:00Z");
			const nextYear = determineNextUpcomingSlot(yearEnd);
			expect(nextYear.mealDate).toBe("2027-01-01");
			expect(nextYear.mealSlot).toBe("breakfast");
		});
	});
});
