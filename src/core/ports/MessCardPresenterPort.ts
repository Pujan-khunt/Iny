import { ResolvedMealInfo, Vendor } from "../entities/MessMeal";

/**
 * Port defining presentation formatting for mess cards.
 */
export interface MessCardPresenterPort {
	/**
	 * Formats a multi-vendor digest for a specific meal slot.
	 */
	renderMultiVendorSlotDigest(info: ResolvedMealInfo, hasEnded: boolean): string;

	/**
	 * Formats a detailed single-vendor menu for a specific meal slot.
	 */
	renderSingleVendorSlotDetail(info: ResolvedMealInfo, vendor: Vendor, hasEnded: boolean): string;

	/**
	 * Formats a full-day menu digest for a single vendor across all meal slots.
	 */
	renderSingleVendorFullDayDigest(info: ResolvedMealInfo, vendor: Vendor, now: Date): string;
}
