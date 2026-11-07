import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type {
	ClaimedFoodWork,
	FoodDecision,
	FoodFailure,
	FoodLease,
	RetryScheduled,
} from "../../../../core/entities/FoodIngestion";
import {
	foodAnnouncementIngestions as work,
	whatsappGroupFoodAnnouncementsMessages as staging,
} from "./schema";

/** Claims admitted sources and records bounded failures using database-owned fences. */
export class PostgresFoodWorkQueue {
	/** @param db Existing connection; claims use short transactions with no external work. */
	constructor(private readonly db: PgDatabase<PgQueryResultHKT, Record<string, unknown>>) {}

	/**
	 * Claims the oldest available admitted source, recovering expired attempts up to three.
	 * @returns One ten-minute fenced attempt or null; persistence failures reject.
	 */
	async claimNext(): Promise<ClaimedFoodWork | null> {
		return this.db.transaction(async (tx) => {
			await this.retireExhausted(tx);
			const [row] = await tx
				.select({ work, staging })
				.from(work)
				.innerJoin(staging, eq(work.messageId, staging.id))
				.where(and(this.runnable(), sql`${work.attemptCount} < 3`))
				.orderBy(asc(work.originalCreatedAt), asc(work.messageId))
				.limit(1)
				.for("update", { skipLocked: true, of: work });
			if (!row) return null;
			const [claimed] = await tx
				.update(work)
				.set({
					state: "processing",
					leaseToken: randomUUID(),
					leaseExpiresAt: sql`clock_timestamp() + interval '10 minutes'`,
					attemptCount: sql`${work.attemptCount} + 1`,
					nextAttemptAt: null,
				})
				.where(and(eq(work.messageId, row.work.messageId), this.runnable()))
				.returning();
			return this.claimedSource(row.staging, claimed);
		});
	}

	/**
	 * Records a current attempt's failure without trusting caller expiry or attempt count.
	 * @param lease Opaque message/token fence; persisted expiry is authoritative.
	 * @param failure Classified failure and available plain diagnostic evidence.
	 * @returns Retry schedule, terminal failure, or lease-lost; persistence failures reject.
	 */
	async fail(lease: FoodLease, failure: FoodFailure): Promise<FoodDecision | RetryScheduled> {
		return this.db.transaction(async (tx) => {
			await tx
				.select({ id: work.messageId })
				.from(work)
				.where(eq(work.messageId, lease.messageId))
				.for("update");
			return this.recordFailure(tx, lease, failure);
		});
	}

	private async recordFailure(
		db: PgDatabase<PgQueryResultHKT, Record<string, unknown>>,
		lease: FoodLease,
		failure: FoodFailure,
	): Promise<FoodDecision | RetryScheduled> {
		const retry = sql`${failure.retriable && failure.code !== "invalid_model_response"} AND ${work.attemptCount} < 3`;
		const delay = Math.max(0, Number.isFinite(failure.retryAfterMs) ? failure.retryAfterMs! : 0);
		const [row] = await db
			.update(work)
			.set({
				state: sql`CASE WHEN ${retry} THEN 'queued' ELSE 'failed' END`,
				nextAttemptAt: sql`CASE WHEN ${retry} THEN clock_timestamp() + greatest(CASE WHEN ${work.attemptCount} = 1 THEN 5000 ELSE 30000 END, ${delay}) * interval '1 millisecond' ELSE NULL END`,
				completedAt: sql`CASE WHEN ${retry} THEN NULL ELSE clock_timestamp() END`,
				leaseToken: null,
				leaseExpiresAt: null,
				decisionReason: failure.code,
				decisionDetail: failure.detail,
				...failure.diagnostics,
			})
			.where(
				and(
					eq(work.messageId, lease.messageId),
					eq(work.state, "processing"),
					eq(work.leaseToken, lease.token),
					sql`${work.leaseExpiresAt} > clock_timestamp()`,
				),
			)
			.returning();
		if (!row) return { outcome: "lease_lost" };
		if (row.state === "queued")
			return { outcome: "retry_scheduled", nextAttemptAt: row.nextAttemptAt! };
		return { outcome: "failed", reason: row.decisionReason!, detail: row.decisionDetail! };
	}
	private runnable() {
		return sql`((${work.state} = 'queued' AND ${work.nextAttemptAt} <= clock_timestamp()) OR (${work.state} = 'processing' AND ${work.leaseExpiresAt} <= clock_timestamp()))`;
	}
	private async retireExhausted(db: PgDatabase<PgQueryResultHKT, Record<string, unknown>>) {
		const exhausted = db
			.select({ id: work.messageId })
			.from(work)
			.where(and(this.runnable(), sql`${work.attemptCount} >= 3`))
			.for("update", { skipLocked: true });
		await db
			.update(work)
			.set({
				state: "failed",
				leaseToken: null,
				leaseExpiresAt: null,
				nextAttemptAt: null,
				completedAt: sql`clock_timestamp()`,
				decisionReason: "attempts_exhausted",
				decisionDetail: "Automatic ingestion exhausted three attempts before completion",
			})
			.where(and(inArray(work.messageId, exhausted), this.runnable()));
	}
	private claimedSource(
		source: typeof staging.$inferSelect,
		claimed: typeof work.$inferSelect,
	): ClaimedFoodWork {
		return {
			source: {
				messageId: claimed.messageId,
				groupJid: claimed.groupJid,
				senderAddress: source.senderAddress,
				senderAddressType: source.senderAddressType,
				deliveryMode: claimed.deliveryMode,
				originalCreatedAt: claimed.originalCreatedAt,
				capturedAt: claimed.capturedAt,
				messageType: source.messageType,
				textBody: source.textBody,
				mediaMimeType: source.mediaMimeType,
				mediaBytes: source.mediaBuffer === null ? null : new Uint8Array(source.mediaBuffer),
			},
			lease: {
				messageId: claimed.messageId,
				token: claimed.leaseToken!,
				expiresAt: claimed.leaseExpiresAt!,
				attempt: claimed.attemptCount,
			},
		};
	}
}
