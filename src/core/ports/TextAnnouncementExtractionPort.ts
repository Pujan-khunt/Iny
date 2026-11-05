import type { StagedCompositeAnnouncement } from "../entities/MessAnnouncement";

/** Legacy composite text extraction for manual operator review. */
export interface TextAnnouncementExtractionPort {
	/**
	 * Extracts the manually reviewed composite without automatic acceptance authority.
	 * @param text Original text announcement.
	 * @param originalTime Original source timestamp used for relative date grounding.
	 * @returns The legacy composite, retaining manual normalization semantics.
	 * @throws On provider failure, invalid JSON, or a malformed composite response.
	 */
	extractAnnouncementEvents(text: string, originalTime: Date): Promise<StagedCompositeAnnouncement>;
}
