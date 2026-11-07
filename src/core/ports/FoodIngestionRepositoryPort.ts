import type { FoodAnnouncementSource } from "../entities/FoodAnnouncement";
import type {
	ClaimedFoodWork,
	FoodDecision,
	FoodFailure,
	FoodLease,
	RetryScheduled,
	ValidatedFoodCommit,
} from "../entities/FoodIngestion";

/** Atomic admission, fenced work claiming, and automatic finalization contracts. */
export interface FoodIngestionRepositoryPort {
	/**
	 * Creates the group's activation boundary with database time, or returns its existing boundary.
	 * @param groupJid Official announcement group identifier.
	 * @returns The persistent activation timestamp; rejects on persistence failure.
	 */
	initialize(groupJid: string): Promise<Date>;
	/**
	 * Preserves a new staging payload and admission decision atomically.
	 * @param source Original transport payload, timestamp, and capture provenance.
	 * @returns Admission, ineligibility, or duplicate; rejects on persistence failure.
	 */
	capture(source: FoodAnnouncementSource): Promise<"admitted" | "ineligible" | "duplicate">;
	/**
	 * Claims previously admitted work using an opaque expiring lease.
	 * @returns One leased source or null when no work is ready; rejects on persistence failure.
	 */
	claimNext(): Promise<ClaimedFoodWork | null>;
	/**
	 * Rechecks prerequisites and atomically writes operational data, audit, and final state.
	 * @param lease Current worker fence.
	 * @param commit Fully validated candidate and audit evidence.
	 * @returns Accepted, rejected, or lease-lost; rejects on persistence failure.
	 */
	accept(lease: FoodLease, commit: ValidatedFoodCommit): Promise<FoodDecision>;
	/**
	 * Records semantic rejection while the lease remains current, without operational writes.
	 * @param lease Current worker fence.
	 * @param decision Reviewed reason/detail with available plain assessment diagnostics.
	 * @returns Rejection or lease-lost; rejects on persistence failure.
	 */
	reject(
		lease: FoodLease,
		decision: Extract<FoodDecision, { outcome: "rejected" }> & {
			readonly diagnostics?: FoodFailure["diagnostics"] &
				Partial<Pick<ValidatedFoodCommit, "candidate" | "evidence" | "verification">>;
		},
	): Promise<FoodDecision>;
	/**
	 * Schedules a permitted bounded transient retry or records terminal failure while fenced.
	 * @param lease Current worker fence.
	 * @param failure Classified infrastructure or response failure.
	 * @returns Final failure, lease-lost, or retry schedule; rejects on persistence failure.
	 */
	fail(lease: FoodLease, failure: FoodFailure): Promise<FoodDecision | RetryScheduled>;
}
