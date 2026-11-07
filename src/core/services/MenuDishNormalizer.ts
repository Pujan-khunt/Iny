import type {
	MenuAliasId,
	MenuCorrection,
	MenuExtractionResult,
	StagedWeeklyMenu,
} from "../entities/MessAnnouncement";

function copyMenu(menu: StagedWeeklyMenu): StagedWeeklyMenu {
	return {
		vendor: menu.vendor,
		meals: menu.meals.map((meal) => ({ ...meal, items: [...meal.items] })),
	};
}

function toInitCap(item: string): string {
	return item.toLowerCase().replace(/(?:^|[^\p{L}\p{N}])(\p{L})/gu, (m) => m.toUpperCase());
}

function isAllCaps(item: string): boolean {
	return /\p{Lu}/u.test(item) && !/\p{Ll}/u.test(item);
}

interface AliasRule {
	readonly id: MenuAliasId;
	readonly pattern: RegExp;
	readonly replacement: string;
}

const ALIAS_RULES: readonly AliasRule[] = [
	{
		id: "frycrums-to-fryums",
		pattern: /(?<![\p{L}\p{M}\p{N}_])Frycrums(?![\p{L}\p{M}\p{N}_])/giu,
		replacement: "Fryums",
	},
	{
		id: "laddo-to-ladoo",
		pattern: /(?<![\p{L}\p{M}\p{N}_])Laddo(?![\p{L}\p{M}\p{N}_])/giu,
		replacement: "Ladoo",
	},
];

function normalizeItem(originalItem: string): {
	correctedItem: string;
	appliedAliases: MenuAliasId[];
} {
	let correctedItem = isAllCaps(originalItem) ? toInitCap(originalItem) : originalItem;
	const appliedAliases: MenuAliasId[] = [];
	for (const rule of ALIAS_RULES) {
		const replaced = correctedItem.replace(rule.pattern, rule.replacement);
		if (replaced !== correctedItem) {
			correctedItem = replaced;
			appliedAliases.push(rule.id);
		}
	}
	return { correctedItem, appliedAliases };
}

function deduplicateItems(items: readonly string[]): string[] {
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const item of items) {
		const key = item.trim().toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			unique.push(item);
		}
	}
	return unique;
}

/** Applies approved dish-name spelling and casing corrections without changing source evidence. */
export class MenuDishNormalizer {
	/**
	 * Copies the supplied menu, normalizes all-caps dish names, and applies approved spelling aliases.
	 * Returns independent raw and working values with one audit record per changed item.
	 * Requires an extracted menu; performs no validation or I/O and does not throw intentionally.
	 */
	static normalize(menu: StagedWeeklyMenu): MenuExtractionResult {
		const rawMenu = copyMenu(menu);
		const workingMenu = copyMenu(menu);
		const corrections: MenuCorrection[] = [];
		for (const meal of workingMenu.meals) {
			const normalizedItems: string[] = [];
			for (let itemIndex = 0; itemIndex < meal.items.length; itemIndex++) {
				const originalItem = meal.items[itemIndex];
				const { correctedItem, appliedAliases } = normalizeItem(originalItem);
				for (const aliasId of appliedAliases) {
					corrections.push({
						mealDate: meal.mealDate,
						mealSlot: meal.mealSlot,
						itemIndex,
						originalItem,
						correctedItem,
						aliasId,
					});
				}
				normalizedItems.push(correctedItem);
			}
			meal.items = deduplicateItems(normalizedItems);
		}
		return { rawMenu, menu: workingMenu, corrections };
	}
}
