import { describe, expect, it } from "vitest";
import type { StagedWeeklyMenu } from "../../../src/core/entities/MessAnnouncement";
import { MenuDishNormalizer } from "../../../src/core/services/MenuDishNormalizer";

function menuWith(items: string[]): StagedWeeklyMenu {
	return {
		vendor: "tcb",
		meals: [{ mealDate: "2026-11-01", mealSlot: "lunch", items }],
	};
}

describe("MenuDishNormalizer", () => {
	it.each([
		["Masala Frycrums/Papad", "Masala Fryums/Papad"],
		["FRYCRUMS", "Fryums"],
		["frycrums", "Fryums"],
		["fRyCrUmS", "Fryums"],
		["(Frycrums)-frycrums, FRYCRUMS!", "(Fryums)-Fryums, Fryums!"],
		["  2 Frycrums / Papad (50g)  ", "  2 Fryums / Papad (50g)  "],
	])("normalizes only the alias in %s", (original, corrected) => {
		const input = menuWith([original]);
		const result = MenuDishNormalizer.normalize(input);
		expect(result.menu.meals[0].items).toEqual([corrected]);
		expect(result.rawMenu).toEqual(menuWith([original]));
		expect(input).toEqual(menuWith([original]));
		expect(result.corrections).toEqual([
			{
				mealDate: "2026-11-01",
				mealSlot: "lunch",
				itemIndex: 0,
				originalItem: original,
				correctedItem: corrected,
				aliasId: "frycrums-to-fryums",
			},
		]);
	});

	it.each([
		["Motichoor Laddo", "Motichoor Ladoo"],
		["LADDO", "Ladoo"],
		["laddo", "Ladoo"],
		["Besan Laddo (1pc)", "Besan Ladoo (1pc)"],
	])("normalizes laddo alias in %s", (original, corrected) => {
		const input = menuWith([original]);
		const result = MenuDishNormalizer.normalize(input);
		expect(result.menu.meals[0].items).toEqual([corrected]);
		expect(result.corrections).toEqual([
			{
				mealDate: "2026-11-01",
				mealSlot: "lunch",
				itemIndex: 0,
				originalItem: original,
				correctedItem: corrected,
				aliasId: "laddo-to-ladoo",
			},
		]);
	});

	it("removes duplicate items in the same mess meal case-insensitively", () => {
		const input = menuWith(["Dal Makhani", "Jeera Rice", "dal makhani", "Roti", "JEERA RICE"]);
		const result = MenuDishNormalizer.normalize(input);
		expect(result.menu.meals[0].items).toEqual(["Dal Makhani", "Jeera Rice", "Roti"]);
	});

	it.each([
		["ALOO PARATHA", "Aloo Paratha"],
		["VEG TAWA MASALA (PANEER)", "Veg Tawa Masala (Paneer)"],
		["VADA PAV ( 2PCS)", "Vada Pav ( 2pcs)"],
		["BREAD BUTTER JAM", "Bread Butter Jam"],
		["DAL FRY", "Dal Fry"],
		["WHITE RICE", "White Rice"],
	])("normalizes all-caps dish %s to Title Case %s", (original, expected) => {
		const input = menuWith([original]);
		const result = MenuDishNormalizer.normalize(input);
		expect(result.menu.meals[0].items).toEqual([expected]);
		expect(result.rawMenu.meals[0].items).toEqual([original]);
		expect(input.meals[0].items).toEqual([original]);
		expect(result.corrections).toEqual([]);
	});

	it("preserves unfamiliar words and attached Unicode letters, marks and numbers", () => {
		const items = [
			"FrycrumsSpecial",
			"नमकीनFrycrums",
			"Frycrumsनमकीन",
			"१Frycrums",
			"Frycrums१",
			"éFrycrums",
			"Frycrumsé",
			"\u0301Frycrums",
			"Frycrums\u0301",
			"_Frycrums",
			"Frycrums_",
			"Undhiyu",
			"Pithla Bhakri",
			"Fryums",
			"Frycrumbs",
			"फ्रायम्स",
		];
		const result = MenuDishNormalizer.normalize(menuWith(items));
		expect(result.menu).toEqual(menuWith(items));
		expect(result.corrections).toEqual([]);
	});

	it("records one correction per changed item with its original date, slot and index", () => {
		const input: StagedWeeklyMenu = {
			vendor: "cheftalk_jain",
			meals: [
				{ mealDate: "2026-11-01", mealSlot: "dinner", items: ["Dal", "Frycrums/Frycrums"] },
				{ mealDate: "2026-11-02", mealSlot: "breakfast", items: ["Frycrums", "Undhiyu"] },
			],
		};
		const result = MenuDishNormalizer.normalize(input);
		expect(result.menu).toEqual({
			vendor: "cheftalk_jain",
			meals: [
				{ mealDate: "2026-11-01", mealSlot: "dinner", items: ["Dal", "Fryums/Fryums"] },
				{ mealDate: "2026-11-02", mealSlot: "breakfast", items: ["Fryums", "Undhiyu"] },
			],
		});
		expect(result.corrections).toEqual([
			{
				mealDate: "2026-11-01",
				mealSlot: "dinner",
				itemIndex: 1,
				originalItem: "Frycrums/Frycrums",
				correctedItem: "Fryums/Fryums",
				aliasId: "frycrums-to-fryums",
			},
			{
				mealDate: "2026-11-02",
				mealSlot: "breakfast",
				itemIndex: 0,
				originalItem: "Frycrums",
				correctedItem: "Fryums",
				aliasId: "frycrums-to-fryums",
			},
		]);
	});

	it("leaves no new corrections when a normalized menu is normalized again", () => {
		const first = MenuDishNormalizer.normalize(menuWith(["Frycrums", "Undhiyu"]));
		expect(first.menu.meals[0].items).toEqual(["Fryums", "Undhiyu"]);
		const second = MenuDishNormalizer.normalize(first.menu);
		expect(second.menu).toEqual(first.menu);
		expect(second.rawMenu).toEqual(first.menu);
		expect(second.corrections).toEqual([]);
	});

	it.each(["Frycrums", "Undhiyu"])(
		"isolates working edits from input and raw evidence for %s",
		(item) => {
			const input = menuWith([item]);
			const result = MenuDishNormalizer.normalize(input);
			result.menu.vendor = "cheftalk_regular";
			result.menu.meals[0].mealDate = "2026-11-03";
			result.menu.meals[0].mealSlot = "dinner";
			result.menu.meals[0].items[0] = "Reviewed dish";
			result.menu.meals[0].items.push("Extra");
			result.menu.meals.push({ mealDate: "2026-11-04", mealSlot: "lunch", items: [] });
			expect(input).toEqual(menuWith([item]));
			expect(result.rawMenu).toEqual(menuWith([item]));
		},
	);

	it("keeps the raw snapshot independent of subsequent input edits", () => {
		const input = menuWith(["Frycrums"]);
		const result = MenuDishNormalizer.normalize(input);
		input.meals[0].items[0] = "Changed source";
		input.meals[0].mealDate = "2026-12-01";
		input.meals.push({ mealDate: "2026-12-02", mealSlot: "dinner", items: [] });
		expect(result.rawMenu).toEqual(menuWith(["Frycrums"]));
		expect(result.menu).toEqual(menuWith(["Fryums"]));
	});
});
