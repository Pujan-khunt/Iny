import {
	ExtractedCompositeAnnouncementSchema,
	type ExtractedCompositeAnnouncement,
} from "../../../common/mess/ExtractionSchemas";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fillDate(value: unknown, field: string, fallback: string): void {
	if (!isRecord(value)) return;
	if (typeof value[field] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value[field])) {
		value[field] = fallback;
	}
}

function fillDates(value: unknown, field: string, fallback: string): void {
	if (Array.isArray(value)) value.forEach((event) => fillDate(event, field, fallback));
}

/**
 * Retains legacy date fallbacks for operator review only; never authorizes automatic ingestion.
 * @param payload Parsed model JSON, normalized before adapter schema validation.
 * @param referenceDate Original source date in IST, used only for the manual fallback.
 * @returns A schema-validated manually reviewed composite.
 * @throws On an invalid legacy payload; dates absent from a source are not automatic evidence.
 */
export function normalizeManualAnnouncement(
	payload: unknown,
	referenceDate: string,
): ExtractedCompositeAnnouncement {
	if (isRecord(payload)) {
		fillDate(payload, "mealDate", referenceDate);
		const mealDate = payload.mealDate as string;
		fillDate(payload.location, "mealDate", mealDate);
		fillDates(payload.timingExtensions, "mealDate", mealDate);
		fillDates(payload.mealChanges, "mealDate", mealDate);
		fillDates(payload.mealSwaps, "targetMealDate", mealDate);
	}
	return ExtractedCompositeAnnouncementSchema.parse(payload);
}
