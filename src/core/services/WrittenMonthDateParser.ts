import { isValidISODate } from "../utils/Temporal";

const MONTH_MAP: Readonly<Record<string, number>> = {
	jan: 1,
	january: 1,
	feb: 2,
	february: 2,
	mar: 3,
	march: 3,
	apr: 4,
	april: 4,
	may: 5,
	jun: 6,
	june: 6,
	jul: 7,
	july: 7,
	aug: 8,
	august: 8,
	sep: 9,
	september: 9,
	oct: 10,
	october: 10,
	nov: 11,
	november: 11,
	dec: 12,
	december: 12,
};

function formatIso(yearStr: string, month: number, dayStr: string): string | null {
	const year = yearStr.length === 2 ? `20${yearStr}` : yearStr;
	const m = String(month).padStart(2, "0");
	const d = String(Number(dayStr)).padStart(2, "0");
	const candidate = `${year}-${m}-${d}`;
	return isValidISODate(candidate) ? candidate : null;
}

/**
 * Parses written dates containing explicit month names and mandatory years.
 * e.g. "6th November 2026", "6 Nov 2026", "November 6, 2026", "6-Nov-2026".
 * Rejects yearless references ("6 November", "Nov 6") to prevent ambiguous dates.
 */
export function parseWrittenMonthDate(token: string): string | null {
	const trimmed = token.trim();
	if (!trimmed) return null;

	// Pattern 1: Day Month Year (e.g. "6th November 2026", "6-Nov-2026")
	const dmy = /^(\d{1,2})(?:st|nd|rd|th)?[\s,/-]+([a-zA-Z]+)[\s,/-]+(\d{2}|\d{4})$/i.exec(trimmed);
	if (dmy) {
		const month = MONTH_MAP[dmy[2].toLowerCase()];
		return month ? formatIso(dmy[3], month, dmy[1]) : null;
	}

	// Pattern 2: Month Day Year (e.g. "November 6, 2026", "Nov 6 2026")
	const mdy = /^([a-zA-Z]+)[\s,/-]+(\d{1,2})(?:st|nd|rd|th)?[\s,/-]+(\d{2}|\d{4})$/i.exec(trimmed);
	if (mdy) {
		const month = MONTH_MAP[mdy[1].toLowerCase()];
		return month ? formatIso(mdy[3], month, mdy[2]) : null;
	}

	return null;
}

/**
 * Extracts all valid written month dates with years from a reference string,
 * replacing matched valid dates with whitespace so remaining text can be checked
 * for yearless/ambiguous month or weekday references.
 */
export function extractWrittenMonthDates(reference: string): {
	dates: string[];
	remaining: string;
} {
	const pattern =
		/\b(?:\d{1,2}(?:st|nd|rd|th)?[\s,/-]+[a-zA-Z]+[\s,/-]+\d{2,4}|[a-zA-Z]+[\s,/-]+\d{1,2}(?:st|nd|rd|th)?[\s,/-]+\d{2,4})\b/gi;
	const dates: string[] = [];
	const remaining = reference.replace(pattern, (match) => {
		const parsed = parseWrittenMonthDate(match);
		if (parsed) {
			dates.push(parsed);
			return " ";
		}
		return match;
	});
	return { dates, remaining };
}
