import type {
	FoodAnnouncementSource as Source,
	FoodCandidate as Candidate,
	SourceEvidence as Evidence,
} from "../entities/FoodAnnouncement";
import type { ValidationResult } from "../entities/FoodIngestion";
import { WeeklyMenuValidator } from "./WeeklyMenuValidator";
import { clauseDate, dateAgrees } from "./AnnouncementDateEvidence";
import { batchAgrees } from "./BatchVenueEvidence";
import { isUnlabeledTcb } from "./MenuVendorInference";
import { validationFailure } from "./ValidationFailure";
type Fields = ReadonlyMap<string, string>;
const jain = /\b(?:cheftalk[ _-]+jain|jain\s+cheftalk)\b/i;
const vendorNames =
	/\b(?:(?:jain|regular|general)\s+cheftalk|cheftalk(?:[ _-]+(?:jain|regular|general))?|tcb|uniworld|(?:the\s+)?craving\s+brew)\b/gi;
function fields(value: unknown, path = ""): [string, string][] {
	if (typeof value === "string") return path === "/kind" ? [] : [[path, value]];
	if (!value || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([key, item]) => fields(item, `${path}/${key}`));
}
function textSpan(text: string, entry: Evidence): boolean {
	const location = entry.location;
	if (location.kind !== "text") return false;
	const { start, end } = location;
	if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
	if (start < 0 || end <= start || end > text.length) return false;
	if (text.slice(start, end) !== entry.rawValue) return false;
	const clauseStart = text.lastIndexOf(entry.clause, start);
	return clauseStart >= 0 && clauseStart + entry.clause.length >= end;
}
function validSpan(source: Source, entry: Evidence): boolean {
	if (!entry.rawValue.trim() || !entry.clause.trim()) return false;
	const location = entry.location;
	if (location.kind === "text") return textSpan(source.textBody ?? "", entry);
	const { page, row, column } = location;
	return source.messageType !== "text" && page === 1 && !!row.trim() && !!column.trim();
}
function vendorMatches(value: string, raw: string, clause: string): boolean {
	const aliases: Record<string, RegExp> = {
		cheftalk_regular:
			/^(?:cheftalk(?:[ _-]+(?:regular|general))?|(?:regular|general)(?:\s+menu)?\s+cheftalk|(?:regular|general)\s+menu)$/i,
		cheftalk_jain: /^(?:cheftalk[ _-]+jain|jain\s+cheftalk|jain\s+menu)$/i,
		tcb: /^(?:tcb|uniworld|(?:the\s+)?craving\s+brew)$/i,
	};
	if (value === "cheftalk_regular" && jain.test(clause)) return false;
	return aliases[value]?.test(raw) ?? false;
}
function jainAtSpan(entry: Evidence, source: Source): boolean {
	if (entry.location.kind !== "text" || !entry.fieldPath.endsWith("/targetVendor")) return false;
	const { start, end } = entry.location,
		text = source.textBody ?? "";
	return /\bjain[ _-]+$/i.test(text.slice(0, start)) || /^[ _-]+jain\b/i.test(text.slice(end));
}
function scopeAgrees(entry: Evidence, source: Source, required: Fields): boolean {
	const body = source.textBody ?? "";
	if (entry.fieldPath === "/menu/vendor")
		return required.get(entry.fieldPath) !== "cheftalk_regular" || !jain.test(body);
	const match = /^\/announcement\/(?:timings|changes|swaps)\/\d+\//.exec(entry.fieldPath);
	if (!match) return true;
	const vendor = required.get(`${match[0]}targetVendor`);
	if (vendor === "cheftalk_regular" && jainAtSpan(entry, source)) return false;
	const names = entry.clause.match(vendorNames) ?? [];
	return names.every((name) => vendor !== undefined && vendorMatches(vendor, name, entry.clause));
}
function changeTypeAgrees(value: string, raw: string): boolean {
	const operations: Record<string, RegExp> = {
		replacement: /\b(?:replace[ds]?|replacing|replacement|instead)\b/i,
		addition: /\b(?:add(?:ed|ition)?|include[ds]?)\b/i,
		cancellation: /\b(?:cancel(?:led|ed|lation)?|remove[ds]?)\b/i,
	};
	return operations[value]?.test(raw) ?? false;
}
function agrees(value: string, entry: Evidence, source: Source, required: Fields): boolean {
	const raw = entry.rawValue.trim();
	const path = entry.fieldPath;
	if (/\/(?:vendor|targetVendor)$/.test(path)) return vendorMatches(value, raw, entry.clause);
	if (/\/(?:mealDate|sourceMealDate|targetMealDate|start|end)$/.test(path)) {
		return dateAgrees(value, entry, source.originalCreatedAt ?? new Date(NaN), required);
	}
	if (/\/(?:hostel|college)Batches\//.test(path)) {
		return batchAgrees(value, raw, path, entry.clause);
	}
	if (path.endsWith("/changeType")) return changeTypeAgrees(value, raw);
	return value.trim().toLowerCase() === raw.toLowerCase();
}
function invalidEntry(
	value: string | undefined,
	source: Source,
	entry: Evidence,
	required: Fields,
	witnesses: ReadonlySet<Evidence>,
): boolean {
	return (
		value === undefined ||
		!validSpan(source, entry) ||
		(!agrees(value, entry, source, required) && !witnesses.has(entry)) ||
		!scopeAgrees(entry, source, required)
	);
}
export class AnnouncementEvidenceValidator {
	static validate(
		source: Source,
		candidate: Candidate,
		evidence: readonly Evidence[],
	): ValidationResult<Candidate> {
		const inferred = isUnlabeledTcb(candidate, source, evidence);
		const required = new Map(
			fields(candidate).filter(([path]) => path !== "/menu/vendor" || !inferred),
		);
		const witnesses =
			candidate.kind === "weekly_menu"
				? WeeklyMenuValidator.rangeWitnesses(candidate, evidence, source.messageType)
				: new Set<Evidence>();
		const covered = new Set<string>();
		for (const entry of evidence) {
			const value = required.get(entry.fieldPath);
			if (invalidEntry(value, source, entry, required, witnesses)) {
				return validationFailure(`Invalid source support for ${entry.fieldPath}.`);
			}
			const date = clauseDate(entry, required, source.originalCreatedAt ?? new Date(NaN));
			if (!date.ok) return date;
			covered.add(entry.fieldPath);
		}
		if (
			[...required.keys()].some(
				(path) =>
					!covered.has(path) &&
					!(candidate.kind === "weekly_menu" && path.startsWith("/menu/meals/")),
			)
		)
			return validationFailure("Required candidate fields lack source evidence.");
		return { ok: true, value: candidate };
	}
}
