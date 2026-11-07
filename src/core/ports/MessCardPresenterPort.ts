import { MealSlot, ResolvedMealInfo, Vendor } from "../entities/MessMeal";

/**
 * Port defining presentation formatting for mess cards.
 */
export interface MessCardPresenterPort {
	/**
	 * Formats a multi-vendor digest for a specific meal slot.
	 */
	renderMultiVendorSlotDigest(info: ResolvedMealInfo, hasEnded: boolean, now?: Date): string;

	/**
	 * Formats a detailed single-vendor menu for a specific meal slot.
	 * Optionally appends a contextual tip if the vendor differs from the user's default vendor.
	 */
	renderSingleVendorSlotDetail(
		info: ResolvedMealInfo,
		vendor: Vendor,
		hasEnded: boolean,
		userDefaultVendor?: Vendor,
		now?: Date,
	): string;

	/**
	 * Formats a full-day menu digest for a single vendor across all meal slots.
	 */
	renderSingleVendorFullDayDigest(info: ResolvedMealInfo, vendor: Vendor, now: Date): string;

	/**
	 * Formats a user-facing notice when no menu data is available for a queried date, vendor, and slot.
	 */
	renderEmptyNotice(date: string, vendor?: Vendor, slot?: MealSlot): string;
}
