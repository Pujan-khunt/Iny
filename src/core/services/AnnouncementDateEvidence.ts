import type { SourceEvidence } from "../entities/FoodAnnouncement";
import type { ValidationResult } from "../entities/FoodIngestion";
import { AnnouncementDateResolver } from "./AnnouncementDateResolver";
import { validateDateRangeClause } from "./DateRangeClauseParser";

type Fields = ReadonlyMap<string, string>;

export function dateAgrees(
	value: string,
	entry: SourceEvidence,
	sourceDate: Date,
	required: Fields,
): boolean {
	let clause = entry.clause;
	if (/\/(?:source|target)MealDate$/.test(entry.fieldPath)) {
		const parts = clause.split(/\b(will serve|will be served instead of|replaces|replacing)\b/i);
		if (parts.length !== 3) return false;
		const targetLeft = parts[1].toLowerCase() === "will serve";
		clause = parts[entry.fieldPath.endsWith("sourceMealDate") === targetLeft ? 2 : 0];
		if (!clause.includes(entry.rawValue)) return false;
		const slots = clause.toLowerCase().match(/\b(?:breakfast|lunch|dinner)\b/g) ?? [];
		if (slots.join() !== required.get(entry.fieldPath.replace(/Date$/, "Slot"))) return false;
	}
	if (validateDateRangeClause(entry.rawValue, value, sourceDate)) return true;
	const refs = /\/(?:source|target)MealDate$/.test(entry.fieldPath)
		? [entry.rawValue, clause]
		: [entry.rawValue];
	const result = AnnouncementDateResolver.resolve(refs, sourceDate);
	return result.ok && result.value === value;
}

export function clauseDate(
	entry: SourceEvidence,
	required: Fields,
	sourceDate: Date,
): ValidationResult<string> {
	const match = /^\/announcement\/(locations|timings|changes)\/\d+\//.exec(entry.fieldPath);
	if (!match) return { ok: true, value: "" };
	const targetMealDate = required.get(`${match[0]}mealDate`);
	if (targetMealDate && validateDateRangeClause(entry.clause, targetMealDate, sourceDate)) {
		return { ok: true, value: targetMealDate };
	}
	const result = AnnouncementDateResolver.resolve([entry.clause], sourceDate);
	if (!result.ok) return result;
	return result.value === targetMealDate
		? result
		: {
				ok: false,
				reason: "conflicting_date",
				detail: "Complete event clause disagrees with event date.",
			};
}
