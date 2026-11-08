import type { ValidationResult } from "../entities/FoodIngestion";
import { getISTDateString, isValidISODate, shiftISODate } from "../utils/Temporal";
import { extractWrittenMonthDates } from "./WrittenMonthDateParser";

const RELATIVE_OFFSETS: Readonly<Record<string, number>> = {
	today: 0,
	yesterday: -1,
	tomorrow: 1,
	tommorow: 1,
	tmrw: 1,
};

function parseDateParts(
	n1: number,
	n2: number,
	sourceDate: string,
): { day: number; month: number } {
	const sourceMonth = Number(sourceDate.slice(5, 7));
	if (n1 === sourceMonth && n2 !== sourceMonth) return { day: n2, month: n1 };
	if (n2 === sourceMonth && n1 !== sourceMonth) return { day: n1, month: n2 };
	if (n2 > 12) return { day: n2, month: n1 };
	return { day: n1, month: n2 };
}

function tryShiftISODate(sourceDate: string, offset: number): string | null {
	try {
		return shiftISODate(sourceDate, offset);
	} catch (error) {
		if (error instanceof RangeError) return null;
		throw error;
	}
}

function resolveToken(token: string, sourceDate: string): string | null {
	const offset = RELATIVE_OFFSETS[token.toLowerCase()];
	if (offset !== undefined) return tryShiftISODate(sourceDate, offset);
	if (isValidISODate(token)) return token;
	const parts = /^(\d{1,2})([/.,-])(\d{1,2})\2(\d{2}|\d{4})$/.exec(token);
	if (!parts) return null;
	const [, n1Str, , n2Str, year] = parts;
	const fullYear = year.length === 2 ? `20${year}` : year;
	const { day, month } = parseDateParts(Number(n1Str), Number(n2Str), sourceDate);
	const date = `${fullYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
	return isValidISODate(date) ? date : null;
}

function resolveReference(reference: string, sourceDate: string): (string | null)[] {
	const { dates: writtenDates, remaining } = extractWrittenMonthDates(reference);
	const weekdays =
		/\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i;
	const month =
		"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
	const monthDate = new RegExp(
		`\\b(?:\\d{1,2}(?:st|nd|rd|th)?\\s+${month}|${month}\\s+\\d{1,2}(?:st|nd|rd|th)?)\\b`,
		"i",
	);
	if (weekdays.test(remaining) || monthDate.test(remaining)) return [null];
	const tokens = remaining.match(
		/\d+(?:\s*[/.-]\s*\d+)+|\b\d{1,2},\d{1,2},(?:20\d{2}|\d{2})\b|\b(?:today|yesterday|tomorrow|tommorow|tmrw)\b/gi,
	);
	const numericDates = tokens ? tokens.map((token) => resolveToken(token, sourceDate)) : [];
	return [...writtenDates, ...numericDates];
}

/** Resolves all stated date evidence without inferring an unstated calendar date. */
export class AnnouncementDateResolver {
	/**
	 * Resolves ISO, day/month/year and relative references using original source IST.
	 * Two-digit years denote 2000..2099. Every reference must agree; invalid,
	 * ambiguous, missing, or contradictory references return a rejection.
	 */
	static resolve(
		rawReferences: readonly string[],
		originalCreatedAt: Date,
	): ValidationResult<string> {
		const invalid = {
			ok: false,
			reason: "invalid_date",
			detail: "Invalid or ambiguous date reference.",
		} as const;
		if (!Number.isFinite(originalCreatedAt.getTime())) return invalid;
		const sourceDate = getISTDateString(originalCreatedAt);
		if (!isValidISODate(sourceDate)) return invalid;
		const references = rawReferences.map((raw) => resolveReference(raw, sourceDate));
		const dates = references.flat();
		if (dates.length === 0) {
			return { ok: false, reason: "missing_date", detail: "No stated date reference." };
		}
		if (dates.includes(null) || references.some((dates) => dates.length === 0)) return invalid;
		const uniqueDates = new Set(dates);
		if (uniqueDates.size !== 1) {
			return { ok: false, reason: "conflicting_date", detail: "Stated dates disagree." };
		}
		return { ok: true, value: dates[0] as string };
	}
}
