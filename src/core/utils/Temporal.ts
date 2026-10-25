/**
 * Pure temporal domain utilities for Indian Standard Time (IST).
 * Adheres strictly to Hexagonal purity with zero external runtime dependencies.
 */

/**
 * Fixed IST (India Standard Time, UTC+05:30) offset in milliseconds.
 * India does not observe Daylight Saving Time (DST).
 */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** Decomposed calendar and clock components in Indian Standard Time (IST). */
export interface ISTDateParts {
	readonly year: number;
	readonly month: number;
	readonly day: number;
	readonly hours: number;
	readonly minutes: number;
}

/**
 * Extracts decomposed date and time components in IST.
 */
export function getISTDateParts(date: Date): ISTDateParts {
	const istDate = new Date(date.getTime() + IST_OFFSET_MS);
	return {
		year: istDate.getUTCFullYear(),
		month: istDate.getUTCMonth() + 1,
		day: istDate.getUTCDate(),
		hours: istDate.getUTCHours(),
		minutes: istDate.getUTCMinutes(),
	};
}

/**
 * Formats a given Date into a standard 'YYYY-MM-DD' calendar date string in IST.
 */
export function getISTDateString(date: Date): string {
	const { year, month, day } = getISTDateParts(date);
	const mm = String(month).padStart(2, "0");
	const dd = String(day).padStart(2, "0");
	return `${year}-${mm}-${dd}`;
}

/**
 * Computes elapsed minutes since midnight (00:00) IST for the given Date.
 */
export function getISTMinutes(date: Date): number {
	const { hours, minutes } = getISTDateParts(date);
	return hours * 60 + minutes;
}

/**
 * Formats a message timestamp into a standardized Indian Standard Time (IST) string.
 */
function formatMessageTimeIST(timestamp?: Date | number | string): string {
	const date = timestamp instanceof Date ? timestamp : new Date(timestamp ?? Date.now());
	return date.toLocaleString("en-IN", {
		timeZone: "Asia/Kolkata",
		dateStyle: "full",
		timeStyle: "medium",
	});
}

/**
 * Injects temporal grounding context into the base system prompt.
 */
export function buildTemporallyGroundedSystemPrompt(
	baseSystemPrompt: string,
	timestamp?: Date | number | string,
): string {
	const istString = formatMessageTimeIST(timestamp);
	return `${baseSystemPrompt}\n\n[Current Time (IST): ${istString}]`;
}
