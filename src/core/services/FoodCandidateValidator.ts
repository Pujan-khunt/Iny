import type { FoodAnnouncementSource } from "../entities/FoodAnnouncement";
import type * as Food from "../entities/FoodIngestion";
import { AnnouncementEvidenceValidator } from "./AnnouncementEvidenceValidator";
import { WeeklyMenuValidator } from "./WeeklyMenuValidator";
import { OperationalAnnouncementValidator } from "./OperationalAnnouncementValidator";

type Assessment = Extract<Food.FoodAssessmentResult, { kind: "candidate" }>;

function invalid(reason: string, detail: string): Food.ValidationResult<never> {
	return { ok: false, reason, detail };
}

/** Pure domain validation coordinating verifier agreement, schema invariants, and evidence. */
export class FoodCandidateValidator {
	/** Validates that an assessment result is fully verified, medium-compatible, and supported by evidence. */
	static validate(
		source: FoodAnnouncementSource,
		result: Food.FoodAssessmentResult,
	): Food.ValidationResult<Assessment> {
		if (result.kind === "rejected") return invalid(result.reason, result.detail);
		const { candidate, evidence, verification: v } = result;
		const accepted = v.verdict === "accept" && v.completeCoverage === true;
		const issues = [v.missingFields, v.conflictingFields, v.unsupportedClauses];
		if (!accepted || !issues.every((list) => Array.isArray(list) && list.length === 0))
			return invalid("ambiguous_content", "Whole-message verification failed.");
		if (
			!["weekly_menu", "operational_announcement"].includes(candidate.kind) ||
			(source.messageType === "text") !== (candidate.kind === "operational_announcement")
		)
			return invalid("unsupported_type", "Candidate type does not match source medium.");
		const typed =
			candidate.kind === "weekly_menu"
				? WeeklyMenuValidator.validate(candidate, evidence, source.messageType)
				: OperationalAnnouncementValidator.validate(candidate, source, evidence);
		if (!typed.ok) return typed;
		const support = AnnouncementEvidenceValidator.validate(source, candidate, evidence);
		return support.ok ? { ok: true, value: result } : support;
	}
}
