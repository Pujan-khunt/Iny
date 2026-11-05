import type { FoodAnnouncementSource } from "../entities/FoodAnnouncement";
import type { FoodAssessmentResult } from "../entities/FoodIngestion";

/** Strict extraction and independent verification of one complete original message. */
export interface FoodAssessmentPort {
	/**
	 * Assesses the source without granting permission to commit a candidate.
	 * @param source Complete original content and provenance.
	 * @param signal Worker cancellation and deadline context.
	 * @returns A candidate with evidence and verification, or semantic rejection.
	 * @throws A typed error carrying FoodFailure on infrastructure or response failure.
	 */
	assess(source: FoodAnnouncementSource, signal: AbortSignal): Promise<FoodAssessmentResult>;
}
