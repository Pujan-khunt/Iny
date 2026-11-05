import type { FoodCandidate, SourceEvidence } from "../entities/FoodAnnouncement";
import type { ValidationResult } from "../entities/FoodIngestion";
import type { StagedWeeklyMenu } from "../entities/MessAnnouncement";
import { isValidISODate, shiftISODate } from "../utils/Temporal";
import { AnnouncementDateResolver } from "./AnnouncementDateResolver";

const slots = ["breakfast", "lunch", "dinner"];
const vendorAliases = {
	cheftalk_regular:
		/^(?:cheftalk(?:[ _-]+(?:regular|general))?|(?:regular|general)(?:\s+menu)?\s+cheftalk|(?:regular|general)\s+menu)$/i,
	cheftalk_jain: /^(?:cheftalk[ _-]+jain|jain\s+cheftalk|jain\s+menu)$/i,
	tcb: /^(?:tcb|uniworld|(?:the\s+)?craving\s+brew)$/i,
};
type MenuSourceType = "text" | "image" | "document";
function vendorSupported(
	candidate: Extract<FoodCandidate, { kind: "weekly_menu" }>,
	vendors: readonly SourceEvidence[],
	sourceType: MenuSourceType,
): boolean {
	const alias = vendorAliases[candidate.menu.vendor];
	const inferredTcb = candidate.menu.vendor === "tcb" && sourceType !== "text" && !vendors.length;
	return (
		!!alias &&
		(vendors.length > 0 || inferredTcb) &&
		vendors.every(
			(e) =>
				alias.test(e.rawValue.trim()) ||
				(inferredTcb && candidate.menu.vendor === "tcb" && !e.rawValue.trim()),
		)
	);
}
function coverage(candidate: Extract<FoodCandidate, { kind: "weekly_menu" }>): boolean {
	const { start, end } = candidate.dateRange;
	if (![start, end].every(isValidISODate)) return false;
	if (candidate.menu.meals.length !== 21) return false;
	let dates: string[];
	try {
		dates = Array.from({ length: 7 }, (_, i) => shiftISODate(start, i));
	} catch (error) {
		if (error instanceof RangeError) return false;
		throw error;
	}
	if (dates[6] !== end) return false;
	const seen = new Set<string>();
	for (const meal of candidate.menu.meals) {
		if (!dates.includes(meal.mealDate) || !slots.includes(meal.mealSlot)) return false;
		const key = `${meal.mealDate}/${meal.mealSlot}`;
		if (seen.has(key)) return false;
		seen.add(key);
	}
	return seen.size === 21;
}
function headerDates(
	candidate: Extract<FoodCandidate, { kind: "weekly_menu" }>,
	evidence: readonly SourceEvidence[],
): boolean {
	return (["start", "end"] as const).every((bound) => {
		const records = evidence.filter((e) => e.fieldPath === `/dateRange/${bound}`);
		if (records.length === 0) return false;
		const result = AnnouncementDateResolver.resolve(
			records.map((e) => e.rawValue),
			new Date(`${candidate.dateRange[bound]}T00:00:00Z`),
		);
		return (
			result.ok &&
			result.value === candidate.dateRange[bound] &&
			records.every((e) => /\d/.test(e.rawValue))
		);
	});
}
/** Enforces complete calendar coverage before considering extracted header support. */
export class WeeklyMenuValidator {
	/**
	 * Returns actual daily-date records justified by an explicitly backed complete range.
	 * Header source identity is still checked by AnnouncementEvidenceValidator.
	 * The witness copies the literal start header, its location and complete range clause;
	 * a separately printed conflicting day cannot be hidden by another good record.
	 */
	static rangeWitnesses(
		candidate: Extract<FoodCandidate, { kind: "weekly_menu" }>,
		evidence: readonly SourceEvidence[],
		sourceType: MenuSourceType = "text",
	): ReadonlySet<SourceEvidence> {
		if (!this.validate(candidate, evidence, sourceType).ok) return new Set();
		const headers = evidence.filter((e) => e.fieldPath.startsWith("/dateRange/"));
		const starts = headers.filter(
			(start) =>
				start.fieldPath === "/dateRange/start" &&
				headers.some(
					(end) =>
						end.fieldPath === "/dateRange/end" &&
						start.clause === end.clause &&
						start.clause.includes(start.rawValue) &&
						start.clause.includes(end.rawValue),
				),
		);
		return new Set(
			evidence.filter(
				(e) =>
					/^\/menu\/meals\/\d+\/mealDate$/.test(e.fieldPath) &&
					starts.some(
						(start) =>
							start.rawValue === e.rawValue &&
							start.clause === e.clause &&
							JSON.stringify(start.location) === JSON.stringify(e.location),
					),
			),
		);
	}

	/** Returns the complete menu or a rejection; never supplies missing slots or headers. */
	static validate(
		candidate: Extract<FoodCandidate, { kind: "weekly_menu" }>,
		evidence: readonly SourceEvidence[],
		sourceType: MenuSourceType = "text",
	): ValidationResult<StagedWeeklyMenu> {
		const reject = (detail: string): ValidationResult<StagedWeeklyMenu> => ({
			ok: false,
			reason: "invalid_menu_coverage",
			detail,
		});
		if (!coverage(candidate))
			return reject("Expected 21 unique slots across seven consecutive dates matching the range.");
		if (
			candidate.menu.meals.some(
				(meal) =>
					!meal.items.length ||
					meal.items.some(
						(item) =>
							!/\p{L}/u.test(item) || /[�?]|\b(?:unreadable|illegible|unknown)\b/i.test(item),
					),
			)
		)
			return reject("Missing or unreadable dish.");
		const vendors = evidence.filter((e) => e.fieldPath === "/menu/vendor");
		if (!vendorSupported(candidate, vendors, sourceType))
			return reject("Unsupported or unbacked vendor.");
		if (
			candidate.menu.vendor === "cheftalk_regular" &&
			vendors.some((e) => /\bjain\b/i.test(e.clause))
		)
			return reject("Unsupported or unbacked vendor.");
		if (!headerDates(candidate, evidence))
			return reject("Missing or conflicting source date range.");
		return { ok: true, value: candidate.menu };
	}
}
