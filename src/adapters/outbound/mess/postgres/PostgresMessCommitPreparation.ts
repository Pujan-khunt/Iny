import type {
	AtomicCommitCompositeOptions,
	AtomicCommitOptions,
	CommitOperationalPayload,
	ResolvedMealSwapInput,
} from "../../../../core/entities/MessCommit";
import type { StagedMealSwap, MenuCorrection } from "../../../../core/entities/MessAnnouncement";
import { MenuDishNormalizer } from "../../../../core/services/MenuDishNormalizer";
import { isValidISODate } from "../../../../core/utils/Temporal";

/** Adapter-private request; caller owns the transaction and automatic lease fence. */
export interface MessCommitOperation {
	readonly messageId: string;
	readonly payload: CommitOperationalPayload;
	readonly mode: "manual" | "automatic";
	readonly swaps?: readonly StagedMealSwap[];
	readonly resolvedSwaps?: readonly ResolvedMealSwapInput[];
	readonly extractionEvidence?: unknown;
}
const list = <T>(value?: T | T[]): T[] =>
	value === undefined ? [] : Array.isArray(value) ? value : [value];
const vendors = ["tcb", "cheftalk_regular", "cheftalk_jain"];

/** Validates all supplied values and creates canonical write data without I/O or decisions. */
export class PostgresMessCommitPreparation {
	/** Converts either legacy manual overload to one adapter-private request. */
	manual(
		input: string | AtomicCommitOptions,
		payload?: CommitOperationalPayload,
	): MessCommitOperation {
		return typeof input === "string"
			? { messageId: input, payload: payload ?? {}, mode: "manual" }
			: { messageId: input.messageId, payload: input, mode: "manual" };
	}
	/** Preserves all reviewed legacy scopes while preparing the composite write shape. */
	composite({
		messageId,
		composite,
		resolvedSwaps,
	}: AtomicCommitCompositeOptions): MessCommitOperation {
		return {
			messageId,
			mode: "manual",
			resolvedSwaps,
			swaps: composite.mealSwaps ?? [],
			payload: {
				locationDetail: composite.location ?? undefined,
				timingExtensions: composite.timingExtensions,
				mealChanges: composite.mealChanges,
			},
		};
	}

	/** Returns independent normalized values and corrections; throws on malformed or duplicate facts. */
	prepare(operation: MessCommitOperation) {
		const payload = operation.payload;
		const corrections: MenuCorrection[] = [];
		const weekly = payload.weeklyMenu && MenuDishNormalizer.normalize(payload.weeklyMenu);
		corrections.push(...(weekly?.corrections ?? []));
		const meals = payload.meals?.map((meal) => {
			const vendor = meal.vendor ?? payload.vendor;
			if (!vendor) throw new Error("Missing vendor for meal");
			const result = MenuDishNormalizer.normalize({
				vendor,
				meals: [{ ...meal, items: [...meal.items] }],
			});
			corrections.push(...result.corrections);
			return { ...meal, vendor, items: result.menu.meals[0].items };
		});
		const normalized = { ...payload, weeklyMenu: weekly?.menu, meals };
		this.validate(normalized);
		const resolvedSwaps = (operation.resolvedSwaps ?? []).map((swap) =>
			this.swap(swap, corrections),
		);
		return { payload: normalized, corrections, resolvedSwaps };
	}
	private swap(swap: ResolvedMealSwapInput, corrections: MenuCorrection[]): ResolvedMealSwapInput {
		this.endpoint(swap.targetMealDate, swap.targetMealSlot);
		this.endpoint(swap.sourceMealDate, swap.sourceMealSlot);
		if (!swap.previousItems.length) throw new Error("previousItems backup must not be empty");
		this.items(swap.previousItems);
		this.items(swap.newItems);
		if (!vendors.includes(swap.vendor)) throw new Error("Invalid swap vendor");
		const normalized = MenuDishNormalizer.normalize({
			vendor: swap.vendor,
			meals: [
				{ mealDate: swap.targetMealDate, mealSlot: swap.targetMealSlot, items: swap.newItems },
			],
		});
		corrections.push(...normalized.corrections);
		return { ...swap, newItems: normalized.menu.meals[0].items };
	}

	private validate(payload: CommitOperationalPayload): void {
		this.locations(payload);
		for (const row of [...(payload.weeklyMenu?.meals ?? []), ...(payload.meals ?? [])]) {
			this.endpoint(row.mealDate, row.mealSlot);
			this.items(row.items);
		}
		const menuVendors = [
			payload.weeklyMenu?.vendor,
			...(payload.meals ?? []).map((row) => row.vendor ?? payload.vendor),
		].filter((v) => v !== undefined);
		if (menuVendors.some((vendor) => !vendors.includes(vendor)))
			throw new Error("Invalid menu vendor");
		this.operational(payload);
	}
	private locations(payload: CommitOperationalPayload): void {
		const locations = list(payload.locationDetails ?? payload.locationDetail);
		const keys = locations.map((row) => `${row.mealDate}/${row.mealSlot ?? "lunch"}`);
		if (new Set(keys).size !== keys.length) throw new Error("Duplicate location date and slot");
		for (const row of locations) {
			this.endpoint(row.mealDate, row.mealSlot ?? "lunch");
			if (!Array.isArray(row.hostelBatches) || !Array.isArray(row.collegeBatches))
				throw new Error("Invalid location batches");
		}
	}

	private operational(payload: CommitOperationalPayload): void {
		for (const row of list(payload.timingExtensions ?? payload.timingExtension)) {
			this.endpoint(row.mealDate, row.mealSlot);
			if (!row.extendedTimings.trim()) throw new Error("Missing timing value");
			if (row.targetVendor != null && !vendors.includes(row.targetVendor))
				throw new Error("Invalid timing vendor");
		}
		for (const row of list(payload.mealChanges ?? payload.mealChange)) this.change(row);
	}
	private change(row: NonNullable<CommitOperationalPayload["mealChange"]>): void {
		this.endpoint(row.mealDate, row.mealSlot);
		if (
			!vendors.includes(row.targetVendor) ||
			!["replacement", "addition", "cancellation"].includes(row.changeType) ||
			!row.affectedItem.trim()
		)
			throw new Error("Invalid dish change");
		if (row.changeType === "replacement" && !row.originalItem?.trim())
			throw new Error("Replacement requires original item");
	}

	private endpoint(date: string, slot: string): void {
		if (!isValidISODate(date) || !["breakfast", "lunch", "dinner"].includes(slot))
			throw new Error("Invalid meal date or slot");
	}
	private items(items: readonly string[]): void {
		if (!items.length || items.some((item) => !item.trim()))
			throw new Error("Menu items must be nonempty");
	}
}
