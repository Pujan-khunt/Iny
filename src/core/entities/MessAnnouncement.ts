import type {
	MealSlot,
	Vendor,
	MealChangeType,
	MessMealLocationDetail,
	MessMealTimingExtension,
	MessMealChange,
} from "./MessMeal";

/** One legacy manually reviewed weekly-menu meal. */
export interface StagedWeeklyMealItem {
	mealDate: string;
	mealSlot: MealSlot;
	items: string[];
}

/** Legacy manually reviewed weekly vendor menu. */
export interface StagedWeeklyMenu {
	vendor: Vendor;
	meals: StagedWeeklyMealItem[];
}

/** One-way whole-meal substitution, optionally scoped to a vendor. */
export interface StagedMealSwap {
	targetMealDate: string;
	targetMealSlot: MealSlot;
	sourceMealDate: string;
	sourceMealSlot: MealSlot;
	targetVendor?: Vendor | null;
}

/** Legacy composite shape retaining the manual flow's optional fields. */
export interface StagedCompositeAnnouncement {
	mealDate: string;
	location?: {
		id?: string;
		mealDate: string;
		mealSlot?: MealSlot;
		hostelBatches: readonly string[] | string[];
		collegeBatches: readonly string[] | string[];
	} | null;
	timingExtensions?: {
		id?: string;
		mealDate: string;
		mealSlot: MealSlot;
		targetVendor?: Vendor | null;
		extendedTimings: string;
	}[];
	mealChanges?: {
		id?: string;
		mealDate: string;
		mealSlot: MealSlot;
		targetVendor: Vendor;
		changeType: MealChangeType;
		affectedItem: string;
		originalItem?: string | null;
	}[];
	mealSwaps?: StagedMealSwap[];
}

/** Automatic location values require a date and slot, excluding row provenance. */
export type LocationUpdate = Pick<
	MessMealLocationDetail,
	"mealDate" | "mealSlot" | "hostelBatches" | "collegeBatches"
>;

/** Automatic timing values retain the stated vendor scope and service timing. */
export type TimingUpdate = Pick<
	MessMealTimingExtension,
	"mealDate" | "mealSlot" | "targetVendor" | "extendedTimings"
>;

/** Automatic dish values retain both replacement identities when applicable. */
export type DishUpdate = Pick<
	MessMealChange,
	"mealDate" | "mealSlot" | "targetVendor" | "changeType" | "affectedItem" | "originalItem"
>;

/** Complete operational announcement, with no legacy defaults or singular location limit. */
export interface OperationalAnnouncement {
	readonly locations: readonly LocationUpdate[];
	readonly timings: readonly TimingUpdate[];
	readonly changes: readonly DishUpdate[];
	readonly swaps: readonly StagedMealSwap[];
}

/** Approved spelling alias identifiers tracked by extraction audits. */
export type MenuAliasId = "frycrums-to-fryums" | "laddo-to-ladoo";

/** Auditable approved spelling correction at a precise menu item position. */
export interface MenuCorrection {
	readonly mealDate: string;
	readonly mealSlot: MealSlot;
	readonly itemIndex: number;
	readonly originalItem: string;
	readonly correctedItem: string;
	readonly aliasId: MenuAliasId;
}

/** Immutable extraction evidence, normalized working menu, and correction provenance. */
export interface MenuExtractionResult {
	readonly rawMenu: StagedWeeklyMenu;
	readonly menu: StagedWeeklyMenu;
	readonly corrections: readonly MenuCorrection[];
}
