import type { MenuExtractionResult } from "../entities/MessAnnouncement";

/** Optional source MIME type and caption/document context for manual menu extraction. */
export interface ExtractWeeklyMenuOptions {
	mimeType?: string;
	textContext?: string;
}

/** Menu extraction for the manually reviewed flow only. */
export interface MenuExtractionPort {
	/**
	 * Extracts the raw weekly menu and applies approved dish spelling normalization.
	 * @param image Complete original image bytes or a rendered PDF page.
	 * @param options Source MIME type and optional source text context.
	 * @returns Raw and normalized menus with correction provenance.
	 * @throws On provider failure, invalid JSON, or a malformed legacy menu payload.
	 */
	extractWeeklyMenu(
		image: Uint8Array,
		options?: ExtractWeeklyMenuOptions,
	): Promise<MenuExtractionResult>;
}
