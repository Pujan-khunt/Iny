import type { FoodAnnouncementSource, FoodCandidate, SourceEvidence } from "./FoodAnnouncement";
import type { MenuExtractionResult } from "./MessAnnouncement";
import type { ResolvedMealSwapInput } from "./MessCommit";

/** Deterministic domain validation result with a machine reason and useful detail. */
export type ValidationResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly reason: string; readonly detail: string };

/** Independent whole-message verification, without a confidence-score acceptance shortcut. */
export interface FoodVerification {
	readonly verdict: "accept" | "reject" | "uncertain";
	readonly completeCoverage: boolean;
	readonly missingFields: readonly string[];
	readonly conflictingFields: readonly string[];
	readonly unsupportedClauses: readonly string[];
}

/** Strict assessment either produces a complete evidenced candidate or abstains. */
export type FoodAssessmentResult =
	| {
			readonly kind: "candidate";
			readonly candidate: FoodCandidate;
			readonly evidence: readonly SourceEvidence[];
			readonly verification: FoodVerification;
			readonly rawExtraction: string;
			readonly rawVerification: string;
			readonly model: string;
			readonly promptVersion: string;
	  }
	| {
			readonly kind: "rejected";
			readonly reason: string;
			readonly detail: string;
			readonly rawExtraction: string;
			readonly rawVerification?: string;
			readonly model: string;
			readonly promptVersion: string;
			readonly recognizedType?: FoodCandidate["kind"];
	  };

/** Classified infrastructure or response failure, separate from semantic rejection. */
export interface FoodFailure {
	readonly code: string;
	readonly detail: string;
	readonly retriable: boolean;
	readonly retryAfterMs?: number;
	/** Plain assessment audit retained by failure persistence, with no SDK objects or headers. */
	readonly diagnostics?: {
		readonly rawExtraction?: string;
		readonly rawVerification?: string;
		readonly model?: string;
		readonly promptVersion?: string;
		readonly recognizedType?: FoodCandidate["kind"];
	};
}

/** Opaque fence for one worker attempt, authoritative even after delayed cancellation. */
export interface FoodLease {
	readonly messageId: string;
	readonly token: string;
	readonly expiresAt: Date;
	readonly attempt: number;
}

/** Original source claimed exclusively for a bounded worker attempt. */
export interface ClaimedFoodWork {
	readonly source: FoodAnnouncementSource;
	readonly lease: FoodLease;
}

/** Validated raw candidate, canonical menu write data, and audit/swap prerequisites. */
export interface ValidatedFoodCommit {
	readonly candidate: FoodCandidate;
	readonly evidence: readonly SourceEvidence[];
	readonly verification: FoodVerification;
	readonly rawExtraction: string;
	readonly rawVerification: string;
	readonly model: string;
	readonly promptVersion: string;
	readonly menuExtraction?: MenuExtractionResult;
	readonly resolvedSwaps: readonly ResolvedMealSwapInput[];
}

/** Worker finalization result; persistence owns completion timestamps. */
export type FoodDecision =
	| { readonly outcome: "accepted" }
	| { readonly outcome: "rejected"; readonly reason: string; readonly detail: string }
	| { readonly outcome: "failed"; readonly reason: string; readonly detail: string }
	| { readonly outcome: "ineligible"; readonly reason: string; readonly detail: string }
	| { readonly outcome: "lease_lost" };

/** Nonterminal work action indicating that a bounded retry was scheduled. */
export interface RetryScheduled {
	readonly outcome: "retry_scheduled";
	readonly nextAttemptAt: Date;
}
