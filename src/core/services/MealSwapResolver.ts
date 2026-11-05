import type { ValidationResult } from "../entities/FoodIngestion";
import type { StagedMealSwap } from "../entities/MessAnnouncement";
import type { ResolvedMealSwapInput } from "../entities/MessCommit";
import type { MealSlot, Vendor } from "../entities/MessMeal";
import type { MessStagingRepositoryPort } from "../ports/MessStagingRepositoryPort";

const vendors: readonly Vendor[] = ["cheftalk_regular", "cheftalk_jain", "tcb"];
type ExpandedSwap = { swap: StagedMealSwap; vendor: Vendor };

/** Resolves every substitution prerequisite without performing operational writes. */
export class MealSwapResolver {
	constructor(private readonly repository: MessStagingRepositoryPort) {}

	/** Rejects the whole set if any scoped source or target cannot be resolved safely. */
	async resolve(
		swaps: readonly StagedMealSwap[],
	): Promise<ValidationResult<readonly ResolvedMealSwapInput[]>> {
		const expanded = this.expand(swaps);
		if (!expanded.ok) return expanded;
		const resolved: ResolvedMealSwapInput[] = [];
		for (const { swap, vendor } of expanded.value) {
			const source = await this.snapshot(swap.sourceMealDate, swap.sourceMealSlot, vendor);
			if (!source.ok) return source;
			const target = await this.snapshot(swap.targetMealDate, swap.targetMealSlot, vendor);
			if (!target.ok) return target;
			resolved.push({
				targetMealDate: swap.targetMealDate,
				targetMealSlot: swap.targetMealSlot,
				sourceMealDate: swap.sourceMealDate,
				sourceMealSlot: swap.sourceMealSlot,
				vendor,
				newItems: source.value,
				previousItems: target.value,
			});
		}
		return { ok: true, value: resolved };
	}

	private expand(swaps: readonly StagedMealSwap[]): ValidationResult<ExpandedSwap[]> {
		const expanded: ExpandedSwap[] = [];
		const targets = new Set<string>();
		for (const swap of swaps) {
			const scope = swap.targetVendor;
			if (scope !== null && (scope === undefined || !vendors.includes(scope))) {
				return {
					ok: false,
					reason: "ambiguous_content",
					detail: "Swap requires explicit vendor scope.",
				};
			}
			for (const vendor of scope === null ? vendors : [scope]) {
				const key = JSON.stringify([swap.targetMealDate, swap.targetMealSlot, vendor]);
				if (targets.has(key)) {
					return {
						ok: false,
						reason: "ambiguous_content",
						detail: `Duplicate swap target: ${key}`,
					};
				}
				targets.add(key);
				expanded.push({ swap, vendor });
			}
		}
		return { ok: true, value: expanded };
	}

	private async snapshot(
		date: string,
		slot: MealSlot,
		vendor: Vendor,
	): Promise<ValidationResult<string[]>> {
		const rows = await this.repository.getMealsByDateAndSlot(date, slot, vendor);
		const meal = rows[0];
		if (
			rows.length !== 1 ||
			!meal ||
			meal.mealDate !== date ||
			meal.mealSlot !== slot ||
			meal.vendor !== vendor ||
			meal.items.length === 0 ||
			meal.items.some((item) => item.trim().length === 0)
		) {
			return {
				ok: false,
				reason: "missing_prerequisite",
				detail: `Expected one nonempty meal: ${date}/${slot}/${vendor}`,
			};
		}
		return { ok: true, value: [...meal.items] };
	}
}
