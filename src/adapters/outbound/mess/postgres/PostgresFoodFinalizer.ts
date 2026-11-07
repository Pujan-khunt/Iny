import { and, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type {
	FoodDecision,
	FoodLease,
	ValidatedFoodCommit,
} from "../../../../core/entities/FoodIngestion";
import type { FoodIngestionRepositoryPort } from "../../../../core/ports/FoodIngestionRepositoryPort";
import type { PostgresMealCommitter } from "./PostgresMealCommitter";
import type { PostgresMessWriteGuard } from "./PostgresMessWriteGuard";
import type { MessCommitOperation } from "./PostgresMessCommitPreparation";
import {
	foodAnnouncementIngestions as work,
	whatsappGroupFoodAnnouncementsMessages as staging,
} from "./schema";
type Transaction = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;
type Rejection = Parameters<FoodIngestionRepositoryPort["reject"]>[1];

/** Finalizes automatic decisions under the shared write lock and worker lease. */
export class PostgresFoodFinalizer {
	/** Injects the caller database and shared operational guard/committer. */
	constructor(
		private readonly db: Transaction,
		private readonly guard: PostgresMessWriteGuard,
		private readonly committer: PostgresMealCommitter,
	) {}
	/**
	 * @param lease Opaque message/token fence; persisted expiry is authoritative.
	 * @param commit Fully validated assessment, canonical menu, and swap snapshots.
	 * @returns An atomic accepted/rejected decision or lease-lost; database failures throw.
	 */
	async accept(lease: FoodLease, commit: ValidatedFoodCommit): Promise<FoodDecision> {
		return this.db.transaction(async (tx) => {
			if (!(await this.current(tx, lease))) return { outcome: "lease_lost" };
			const decision = await this.committer.commitWithinTransaction(
				tx,
				this.operation(lease, commit),
			);
			if (decision.outcome === "accepted" || decision.outcome === "rejected")
				await this.complete(tx, lease, decision, {
					candidate: commit.candidate,
					evidence: commit.evidence,
					verification: commit.verification,
					rawExtraction: commit.rawExtraction,
					rawVerification: commit.rawVerification,
					model: commit.model,
					promptVersion: commit.promptVersion,
					recognizedType: commit.candidate.kind,
					corrections: commit.menuExtraction?.corrections ?? [],
				});
			return decision;
		});
	}
	/**
	 * @param lease Opaque current worker fence, never caller-supplied expiry authority.
	 * @param decision Semantic reason/detail and available plain diagnostic data.
	 * @returns Persisted rejection or lease-lost without writes; database failures throw.
	 */
	async reject(lease: FoodLease, decision: Rejection): Promise<FoodDecision> {
		return this.db.transaction(async (tx) => {
			if (!(await this.current(tx, lease))) return { outcome: "lease_lost" };
			const result = {
				outcome: "rejected" as const,
				reason: decision.reason,
				detail: decision.detail,
			};
			await this.complete(tx, lease, result, decision.diagnostics ?? {});
			return result;
		});
	}
	private async current(tx: Transaction, lease: FoodLease): Promise<boolean> {
		await this.guard.lock(tx);
		await tx
			.select({ id: work.messageId })
			.from(work)
			.where(eq(work.messageId, lease.messageId))
			.for("update");
		const [row] = await tx
			.select({ id: work.messageId })
			.from(work)
			.where(
				and(
					eq(work.messageId, lease.messageId),
					eq(work.state, "processing"),
					eq(work.leaseToken, lease.token),
					sql`${work.leaseExpiresAt} > clock_timestamp()`,
				),
			);
		return Boolean(row);
	}
	private async complete(
		tx: Transaction,
		lease: FoodLease,
		decision: Extract<FoodDecision, { outcome: "accepted" | "rejected" }>,
		diagnostics: NonNullable<Rejection["diagnostics"]> & { corrections?: unknown },
	): Promise<void> {
		if (decision.outcome === "rejected")
			await tx
				.update(staging)
				.set({ status: "ignored" })
				.where(and(eq(staging.id, lease.messageId), eq(staging.status, "pending")));
		await tx
			.update(work)
			.set({
				...diagnostics,
				state: decision.outcome,
				completedAt: sql`clock_timestamp()`,
				leaseToken: null,
				leaseExpiresAt: null,
				nextAttemptAt: null,
				decisionReason: decision.outcome === "rejected" ? decision.reason : null,
				decisionDetail: decision.outcome === "rejected" ? decision.detail : null,
			})
			.where(eq(work.messageId, lease.messageId));
	}
	private operation(lease: FoodLease, commit: ValidatedFoodCommit): MessCommitOperation {
		const candidate = commit.candidate;
		const payload =
			candidate.kind === "weekly_menu"
				? {
						weeklyMenu: commit.menuExtraction?.menu ?? candidate.menu,
						extractionAudit: commit.menuExtraction && {
							...commit.menuExtraction,
							reviewCorrections: [],
						},
					}
				: {
						locationDetails: [...candidate.announcement.locations],
						timingExtensions: [...candidate.announcement.timings],
						mealChanges: [...candidate.announcement.changes],
					};
		return {
			messageId: lease.messageId,
			mode: "automatic",
			payload,
			resolvedSwaps: commit.resolvedSwaps,
			swaps: candidate.kind === "operational_announcement" ? candidate.announcement.swaps : [],
			extractionEvidence: commit,
		};
	}
}
