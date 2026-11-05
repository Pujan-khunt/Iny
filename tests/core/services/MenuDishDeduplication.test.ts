import { describe, expect, it } from "vitest";
import type { StagedWeeklyMenu } from "../../../src/core/entities/MessAnnouncement";
import { MenuDishNormalizer } from "../../../src/core/services/MenuDishNormalizer";

function menuWith(items: string[]): StagedWeeklyMenu {
	return {
		vendor: "tcb",
		meals: [{ mealDate: "2026-11-01", mealSlot: "lunch", items }],
	};
}

describe("MenuDishNormalizer deduplication and Ladoo alias", () => {
	it.each([
		["Besan Laddo", "Besan Ladoo"],
		["LADDO", "Ladoo"],
		["laddo", "Ladoo"],
		["Motichoor Laddo / Gulab Jamun", "Motichoor Ladoo / Gulab Jamun"],
	])("normalizes Laddo alias in %s to %s", (original, corrected) => {
		const input = menuWith([original]);
		const result = MenuDishNormalizer.normalize(input);
		expect(result.menu.meals[0].items).toEqual([corrected]);
		expect(result.rawMenu).toEqual(menuWith([original]));
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

	it("removes duplicate items from the same meal preserving first occurrence order", () => {
		const items = [
			"Vermicelli Upma",
			"Chutney",
			"Tea / Coffee",
			"Mix Fruit (1 Serve)",
			"Mix Fruit (1 Serve)",
			"Nutella",
			"Hot Milk",
		];
		const input = menuWith(items);
		const result = MenuDishNormalizer.normalize(input);
		expect(result.menu.meals[0].items).toEqual([
			"Vermicelli Upma",
			"Chutney",
			"Tea / Coffee",
			"Mix Fruit (1 Serve)",
			"Nutella",
			"Hot Milk",
		]);
		expect(result.rawMenu.meals[0].items).toEqual(items);
	});

	it("removes case-insensitive and whitespace duplicate items within the same meal", () => {
		const items = ["Dal Tadka", "  dal tadka  ", "Jeera Rice", "jeera rice", "DAL TADKA"];
		const input = menuWith(items);
		const result = MenuDishNormalizer.normalize(input);
		expect(result.menu.meals[0].items).toEqual(["Dal Tadka", "Jeera Rice"]);
	});

	it("handles duplicates across multiple meals independently", () => {
		const input: StagedWeeklyMenu = {
			vendor: "tcb",
			meals: [
				{ mealDate: "2026-11-01", mealSlot: "breakfast", items: ["Poha", "Poha", "Tea"] },
				{ mealDate: "2026-11-01", mealSlot: "lunch", items: ["Rice", "Dal", "Rice"] },
			],
		};
		const result = MenuDishNormalizer.normalize(input);
		expect(result.menu.meals[0].items).toEqual(["Poha", "Tea"]);
		expect(result.menu.meals[1].items).toEqual(["Rice", "Dal"]);
		expect(result.rawMenu.meals[0].items).toEqual(["Poha", "Poha", "Tea"]);
		expect(result.rawMenu.meals[1].items).toEqual(["Rice", "Dal", "Rice"]);
	});
});
