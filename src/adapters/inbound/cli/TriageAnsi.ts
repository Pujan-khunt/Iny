export interface AnsiTheme {
	reset: string;
	bold: string;
	dim: string;
	green: string;
	yellow: string;
	red: string;
	cyan: string;
	magenta: string;
	blue: string;
	gray: string;
}

export const RAW_ANSI: AnsiTheme = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	cyan: "\x1b[36m",
	magenta: "\x1b[35m",
	blue: "\x1b[34m",
	gray: "\x1b[90m",
};

export const NO_ANSI: AnsiTheme = {
	reset: "",
	bold: "",
	dim: "",
	green: "",
	yellow: "",
	red: "",
	cyan: "",
	magenta: "",
	blue: "",
	gray: "",
};

export const DIVIDER_LINE =
	"========================================================================================";
export const SUB_DIVIDER =
	"----------------------------------------------------------------------------------------";

/**
 * Strips ANSI escape sequences from text.
 */
export function stripAnsi(text: string): string {
	// eslint-disable-next-line no-control-regex
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Formats a Date object into Indian Standard Time (IST) strings.
 */
export function formatIst(date: Date | null | undefined): string {
	if (!date || isNaN(date.getTime())) return "N/A";
	const istMs = date.getTime() + (5 * 60 + 30) * 60 * 1000;
	const istDate = new Date(istMs);

	const yyyy = istDate.getUTCFullYear();
	const mm = String(istDate.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(istDate.getUTCDate()).padStart(2, "0");
	const hh = String(istDate.getUTCHours()).padStart(2, "0");
	const min = String(istDate.getUTCMinutes()).padStart(2, "0");
	const ss = String(istDate.getUTCSeconds()).padStart(2, "0");

	return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} IST`;
}

export function formatIstAmPm(date: Date | null | undefined): string {
	if (!date || isNaN(date.getTime())) return "N/A";
	const istMs = date.getTime() + (5 * 60 + 30) * 60 * 1000;
	const istDate = new Date(istMs);

	const yyyy = istDate.getUTCFullYear();
	const mm = String(istDate.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(istDate.getUTCDate()).padStart(2, "0");

	let hours = istDate.getUTCHours();
	const ampm = hours >= 12 ? "PM" : "AM";
	hours = hours % 12;
	hours = hours ? hours : 12;
	const hh = String(hours).padStart(2, "0");
	const min = String(istDate.getUTCMinutes()).padStart(2, "0");

	return `${yyyy}-${mm}-${dd} ${hh}:${min} ${ampm} IST`;
}

export function getDayOfWeekName(dateStr: string): string {
	const d = new Date(`${dateStr}T00:00:00Z`);
	const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	return dayNames[d.getUTCDay()] ?? "";
}

export function getDayOfWeekShort(dateStr: string): string {
	const d = new Date(`${dateStr}T00:00:00Z`);
	const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	return dayNames[d.getUTCDay()] ?? "";
}
