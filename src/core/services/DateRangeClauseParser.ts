import { extractWrittenMonthDates } from "./WrittenMonthDateParser";
import { isValidISODate, shiftISODate } from "../utils/Temporal";

const RELATIVE_OFFSETS: Readonly<Record<string, number>> = {
	today: 0,
	yesterday: -1,
	tomorrow: 1,
	tommorow: 1,
	tmrw: 1,
};

function parseNumericToken(token: string, sourceIso: string): string | null {
	const offset = RELATIVE_OFFSETS[token.toLowerCase()];
	if (offset !== undefined) return shiftISODate(sourceIso, offset);
	if (isValidISODate(token)) return token;
	const parts = /^(\d{1,2})([/.,-])(\d{1,2})\2(\d{2}|\d{4})$/.exec(token);
	if (!parts) return null;
	const [, n1Str, , n2Str, year] = parts;
	const fullYear = year.length === 2 ? `20${year}` : year;
	const n1 = Number(n1Str);
	const n2 = Number(n2Str);
	const sourceMonth = Number(sourceIso.slice(5, 7));
	const { day, month } =
		n1 === sourceMonth && n2 !== sourceMonth
			? { day: n2, month: n1 }
			: n2 > 12
				? { day: n2, month: n1 }
				: { day: n1, month: n2 };
	const iso = `${fullYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
	return isValidISODate(iso) ? iso : null;
}

/**
 * Validates whether candidate mealDate falls inclusively within a date range
 * expressed in an announcement supporting clause (e.g. "from 6th November 2026 to 12th November 2026").
 */
export function validateDateRangeClause(
	clause: string,
	targetMealDate: string,
	sourceCreatedAt: Date,
): boolean {
	if (!/\b(?:from|between|to|till|until|-)\b/i.test(clause)) return false;
	const sourceIso = sourceCreatedAt.toISOString().slice(0, 10);
	const { dates: writtenDates, remaining } = extractWrittenMonthDates(clause);
	const tokens =
		remaining.match(/\d+(?:\s*[/.,-]\s*\d+)+|\b(?:today|yesterday|tomorrow|tommorow|tmrw)\b/gi) ??
		[];
	const numericDates = tokens
		.map((t) => parseNumericToken(t, sourceIso))
		.filter((d): d is string => d !== null);

	const allDates = [...writtenDates, ...numericDates];
	if (allDates.length !== 2) return false;

	const [startDate, endDate] = allDates;
	if (startDate > endDate) return false;

	return targetMealDate >= startDate && targetMealDate <= endDate;
}
