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
 * Formats a message timestamp into a standardized 'YYYY-MM-DD HH:mm IST' string.
 */
export function formatHistoricalMessageTimeIST(date: Date): string {
	const { year, month, day, hours, minutes } = getISTDateParts(date);
	const mm = String(month).padStart(2, "0");
	const dd = String(day).padStart(2, "0");
	const hh = String(hours).padStart(2, "0");
	const min = String(minutes).padStart(2, "0");
	return `${year}-${mm}-${dd} ${hh}:${min} IST`;
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

/** Returns true only for a real calendar date formatted exactly as YYYY-MM-DD. */
export function isValidISODate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [year, month, day] = value.split("-").map(Number);
	const date = new Date(`${value}T00:00:00.000Z`);
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
	);
}

/**
 * Shifts a strict ISO date by integer calendar days, independent of timezone.
 * Throws RangeError for invalid dates, noninteger offsets, or calendar overflow.
 */
export function shiftISODate(value: string, days: number): string {
	if (!isValidISODate(value) || !Number.isInteger(days)) {
		throw new RangeError("Expected a valid ISO date and integer day offset.");
	}
	const date = new Date(`${value}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + days);
	const result = date.toISOString().slice(0, 10);
	if (!isValidISODate(result)) throw new RangeError("Date exceeds ISO calendar bounds.");
	return result;
}

/** Returns integer calendar days from one strict ISO date to another; invalid dates throw. */
export function daysBetweenISODates(from: string, to: string): number {
	if (!isValidISODate(from) || !isValidISODate(to))
		throw new RangeError("Expected valid ISO dates.");
	return (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86400000;
}

function formatOrdinal(day: number): string {
	const mod100 = day % 100;
	if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
	const suffixes: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };
	return `${day}${suffixes[day % 10] ?? "th"}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Formats an ISO calendar date into natural conversational IST text (e.g. 'Today, Friday, 8th Nov'). */
export function formatDateISTNatural(dateStr: string, now: Date | null = new Date()): string {
	const [y, m, d] = dateStr.split("-").map(Number);
	const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
	const weekday = WEEKDAYS[date.getUTCDay()];
	const month = MONTHS[date.getUTCMonth()];
	const dayOrdinal = formatOrdinal(date.getUTCDate());
	let prefix = "";
	if (now) {
		const todayIST = getISTDateString(now);
		if (dateStr === todayIST) prefix = "Today, ";
		else if (dateStr === shiftISODate(todayIST, 1)) prefix = "Tomorrow, ";
		else if (dateStr === shiftISODate(todayIST, -1)) prefix = "Yesterday, ";
	}
	return `${prefix}${weekday}, ${dayOrdinal} ${month}`;
}
