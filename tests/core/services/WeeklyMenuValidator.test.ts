import { describe, expect, it } from "vitest";
import type { FoodCandidate, SourceEvidence } from "../../../src/core/entities/FoodAnnouncement";
import { WeeklyMenuValidator } from "../../../src/core/services/WeeklyMenuValidator";

type Menu = Extract<FoodCandidate, { kind: "weekly_menu" }>;
const slots = ["breakfast", "lunch", "dinner"] as const;
function fixture(): Menu {
	return {
		kind: "weekly_menu",
		dateRange: { start: "2026-11-01", end: "2026-11-07" },
		menu: {
			vendor: "tcb",
			meals: Array.from({ length: 21 }, (_, i) => ({
				mealDate: `2026-11-0${Math.floor(i / 3) + 1}`,
				mealSlot: slots[i % 3],
				items: ["Poha"],
			})),
		},
	};
}
function evidence(): SourceEvidence[] {
	return [
		["/menu/vendor", "Uniworld"],
		["/dateRange/start", "1/11/26"],
		["/dateRange/end", "7/11/26"],
	].map(([fieldPath, rawValue]) => ({
		fieldPath,
		rawValue,
		clause: rawValue,
		location: { kind: "image", page: 1, row: "header", column: "date" },
	}));
}
describe("WeeklyMenuValidator", () => {
	it("accepts seven consecutive dates with each slot exactly once", () => {
		expect(WeeklyMenuValidator.validate(fixture(), evidence()).ok).toBe(true);
	});
	it("accepts comma-delimited date range headers", () => {
		const e = evidence();
		e[1] = { ...e[1], rawValue: "1,11,2026", clause: "1,11,2026 TO 7,11,2026" };
		e[2] = { ...e[2], rawValue: "7,11,2026", clause: "1,11,2026 TO 7,11,2026" };
		expect(WeeklyMenuValidator.validate(fixture(), e).ok).toBe(true);
	});
	it("rejects 21 entries that repeat one day before checking evidence", () => {
		const candidate = fixture();
		candidate.menu.meals.forEach((meal) => {
			meal.mealDate = "2026-11-01";
		});
		expect(WeeklyMenuValidator.validate(candidate, [])).toMatchObject({
			ok: false,
			reason: "invalid_menu_coverage",
		});
	});
	it.each([
		"missing slot",
		"outside range",
		"invalid calendar",
		"blank dish",
		"unknown vendor",
		"range mismatch",
	])("rejects %s", (problem) => {
		const c = fixture();
		if (problem === "missing slot") c.menu.meals.pop();
		if (problem === "outside range") c.menu.meals[0].mealDate = "2026-10-31";
		if (problem === "invalid calendar") c.menu.meals[0].mealDate = "2026-02-30";
		if (problem === "blank dish") c.menu.meals[0].items = ["  "];
		if (problem === "unknown vendor") c.menu.vendor = "unknown" as "tcb";
		if (problem === "range mismatch") Object.assign(c.dateRange, { end: "2026-11-08" });
		expect(WeeklyMenuValidator.validate(c, evidence()).ok).toBe(false);
	});
	it.each(["vendor", "start", "end"])("requires source-backed %s", (field) => {
		expect(
			WeeklyMenuValidator.validate(
				fixture(),
				evidence().filter((e) => !e.fieldPath.endsWith(field)),
			).ok,
		).toBe(false);
	});
	it("rejects a competing header instead of selecting matching evidence", () => {
		const records = evidence();
		records.push({ ...records[1], rawValue: "2/11/26" });
		expect(WeeklyMenuValidator.validate(fixture(), records).ok).toBe(false);
	});
	it("rejects calendar overflow without throwing", () => {
		const c = fixture();
		Object.assign(c.dateRange, { start: "9999-12-31", end: "9999-12-31" });
		expect(() => WeeklyMenuValidator.validate(c, evidence())).not.toThrow();
		expect(WeeklyMenuValidator.validate(c, evidence()).ok).toBe(false);
	});
	it.each(["[unreadable]", "???", "1234"])("rejects unreadable item %s", (item) => {
		const c = fixture();
		c.menu.meals[0].items = [item];
		expect(WeeklyMenuValidator.validate(c, evidence()).ok).toBe(false);
	});
	it.each([
		["cheftalk_regular", "Cheftalk general", true],
		["cheftalk_regular", "REGULAR MENU", true],
		["cheftalk_regular", "GENERAL MENU", true],
		["cheftalk_jain", "Cheftalk Jain", true],
		["cheftalk_jain", "JAIN MENU", true],
		["cheftalk_regular", "Cheftalk", true],
		["cheftalk_regular", "Cheftalk regular", true],
		["cheftalk_regular", "Cheftalk Jain", false],
		["cheftalk_jain", "Cheftalk", false],
		["tcb", "THE CRAVING BREW", true],
		["tcb", "The Craving Brew", true],
		["tcb", "Craving Brew", true],
		["tcb", "TCB", true],
		["tcb", "Uniworld", true],
	] as const)("checks vendor %s backed by %s", (vendor, rawValue, want) => {
		const c = fixture();
		c.menu.vendor = vendor;
		const e = evidence();
		e[0] = { ...e[0], rawValue };
		expect(WeeklyMenuValidator.validate(c, e).ok).toBe(want);
	});
	it("infers TCB for a complete unlabeled media menu", () => {
		const c = fixture();
		c.menu.vendor = "tcb";
		const records = evidence().filter((entry) => entry.fieldPath !== "/menu/vendor");
		expect(WeeklyMenuValidator.validate(c, records, "image").ok).toBe(true);
	});
	it("validates a full TCB weekly menu with The Craving Brew header and MM/DD/YY dates", () => {
		const c: Menu = {
			kind: "weekly_menu",
			dateRange: { start: "2026-11-02", end: "2026-11-08" },
			menu: {
				vendor: "tcb",
				meals: Array.from({ length: 21 }, (_, i) => ({
					mealDate: `2026-11-0${Math.floor(i / 3) + 2}`,
					mealSlot: slots[i % 3],
					items: ["Aloo Paratha"],
				})),
			},
		};
		const e: SourceEvidence[] = [
			{
				fieldPath: "/menu/vendor",
				rawValue: "THE CRAVING BREW",
				clause: "THE CRAVING BREW",
				location: { kind: "image", page: 1, row: "Title", column: "Center" },
			},
			{
				fieldPath: "/dateRange/start",
				rawValue: "11/02/26",
				clause: "Date 11/02/26 11/03/26 11/04/26 11/05/26 11/06/26 11/07/26 11/08/26",
				location: { kind: "image", page: 1, row: "Date", column: "Monday" },
			},
			{
				fieldPath: "/dateRange/end",
				rawValue: "11/08/26",
				clause: "Date 11/02/26 11/03/26 11/04/26 11/05/26 11/06/26 11/07/26 11/08/26",
				location: { kind: "image", page: 1, row: "Date", column: "Sunday" },
			},
		];
		expect(WeeklyMenuValidator.validate(c, e, "image")).toEqual({ ok: true, value: c.menu });
	});
});

it("does not erase explicit Jain in the complete vendor header", () => {
	const c = fixture();
	c.menu.vendor = "cheftalk_regular";
	const e = evidence();
	e[0] = { ...e[0], rawValue: "Cheftalk", clause: "Cheftalk Jain weekly menu" };
	expect(WeeklyMenuValidator.validate(c, e).ok).toBe(false);
});
