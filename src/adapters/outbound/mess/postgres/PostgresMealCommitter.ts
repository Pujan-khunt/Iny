import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { LoggerPort } from "../../../../core/ports/LoggerPort";
import type { MealSlot, Vendor } from "../../../../core/entities/MessMeal";
import type { FoodDecision } from "../../../../core/entities/FoodIngestion";
import type {
	AtomicCommitCompositeOptions,
	AtomicCommitOptions,
	CommitOperationalPayload,
	StagedMealLookupRecord,
} from "../../../../core/ports/MessStagingRepositoryPort";
import { PostgresOperationalWriter } from "./PostgresOperationalWriter";
import { PostgresSwapWriter } from "./PostgresSwapWriter";
import { PostgresMessWriteGuard } from "./PostgresMessWriteGuard";
import { PostgresMessOperationAudit } from "./PostgresMessOperationAudit";
import {
	PostgresMessCommitPreparation,
	type MessCommitOperation,
} from "./PostgresMessCommitPreparation";
type Transaction = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

/** Shared guarded atomic operational writes; manual callers own one outer transaction. */
export class PostgresMealCommitter {
	/** All persistence collaborators are supplied by the composition root. */
	constructor(
		private readonly db: Transaction,
		private readonly logger: LoggerPort,
		private readonly writer: PostgresOperationalWriter,
		private readonly swapWriter: PostgresSwapWriter,
		private readonly guard: PostgresMessWriteGuard,
		private readonly audit: PostgresMessOperationAudit,
		private readonly preparation: PostgresMessCommitPreparation,
	) {}
	/** Returns manual resolver snapshots for an endpoint and optional vendor; SQL failures reject. */
	async getMealsByDateAndSlot(
		mealDate: string,
		mealSlot: MealSlot | string,
		vendor?: Vendor | string | null,
	): Promise<StagedMealLookupRecord[]> {
		const rows = await this.audit.meals(this.db, mealDate, mealSlot as MealSlot);
		return vendor ? rows.filter((row) => row.vendor === vendor) : rows;
	}
	/** Commits reviewed values; semantic preflight rejection throws reason/detail without writes. */
	async atomicCommit(options: AtomicCommitOptions): Promise<void>;
	/** Commits the reviewed payload for a staged source; conflicts and SQL failures reject atomically. */
	async atomicCommit(messageId: string, payload: CommitOperationalPayload): Promise<void>;
	/** Normalizes either public request form before guarded transactional persistence. */
	async atomicCommit(
		messageIdOrOptions: string | AtomicCommitOptions,
		maybePayload?: CommitOperationalPayload,
	): Promise<void> {
		await this.manual(this.preparation.manual(messageIdOrOptions, maybePayload));
	}
	/** Commits all reviewed operational clauses and complete swap snapshots or throws atomically. */
	async atomicCommitComposite(options: AtomicCommitCompositeOptions): Promise<void> {
		await this.manual(this.preparation.composite(options));
	}

	private async manual(operation: MessCommitOperation): Promise<void> {
		await this.db.transaction(async (tx) => {
			const decision = await this.commitWithinTransaction(tx, operation);
			if (decision.outcome !== "accepted")
				throw new Error(
					"reason" in decision ? `${decision.reason}: ${decision.detail}` : decision.outcome,
				);
		});
		this.logger.info("Successfully committed staging message", { messageId: operation.messageId });
	}
	/**
	 * Uses the existing caller transaction, acquiring the shared lock before staging checks.
	 * Returns semantic rejection without writes; validation/SQL errors throw and must roll back.
	 * Automatic callers acquire the shared lock before their lease fence, then call this method.
	 * Reacquiring the same transaction lock is safe; this method writes no automatic decision.
	 */
	async commitWithinTransaction(
		tx: Transaction,
		operation: MessCommitOperation,
	): Promise<FoodDecision> {
		await this.guard.lock(tx);
		if (!(await this.guard.permits(tx, operation)))
			return {
				outcome: "rejected",
				reason: "staging_conflict",
				detail: "Staging no longer permits this operation",
			};
		const prepared = this.preparation.prepare(operation);
		const keys = PostgresMessOperationAudit.factKeys(prepared.payload, operation.resolvedSwaps);
		const source = await this.audit.source(tx, operation.messageId);
		const originalCreatedAt = source?.originalCreatedAt ?? null;
		const order = await this.guard.checkOrder(
			tx,
			{ messageId: operation.messageId, originalCreatedAt },
			keys,
		);
		if (order.outcome !== "accepted") return order;
		const swaps = await this.guard.checkSwapSnapshots(tx, {
			swaps: operation.swaps ?? [],
			resolvedSwaps: operation.resolvedSwaps ?? [],
			mode: operation.mode,
		});
		if (swaps.outcome !== "accepted") return swaps;
		await this.apply(tx, operation, prepared, keys, source);
		return { outcome: "accepted" };
	}
	private async apply(
		tx: Transaction,
		operation: MessCommitOperation,
		prepared: ReturnType<PostgresMessCommitPreparation["prepare"]>,
		keys: string[],
		source: Awaited<ReturnType<PostgresMessOperationAudit["source"]>>,
	) {
		const beforeImages = await this.audit.operationSnapshot(tx, keys, operation.resolvedSwaps);
		await this.write(tx, operation.messageId, prepared.payload, {
			...operation,
			resolvedSwaps: prepared.resolvedSwaps,
		});
		const afterImages = await this.audit.operationSnapshot(tx, keys, operation.resolvedSwaps);
		await this.audit.record(tx, {
			operation,
			source: source?.source,
			originalCreatedAt: source?.originalCreatedAt ?? null,
			keys,
			corrections: prepared.corrections,
			beforeImages,
			afterImages,
		});
		await this.writer.markProcessed(tx, operation.messageId);
		if (operation.mode === "manual")
			await this.audit.manualDisposition(tx, "manual_override", operation.messageId);
	}

	private async write(
		tx: Transaction,
		id: string,
		payload: CommitOperationalPayload,
		operation: MessCommitOperation,
	) {
		await this.writer.commitMeals(tx, id, payload);
		await this.writer.commitLocations(tx, id, payload.locationDetails ?? payload.locationDetail);
		await this.writer.commitTimings(tx, id, payload.timingExtensions ?? payload.timingExtension);
		await this.writer.commitChanges(tx, id, payload.mealChanges ?? payload.mealChange);
		await this.swapWriter.commitSwaps(
			tx,
			id,
			operation.resolvedSwaps ? [...operation.resolvedSwaps] : undefined,
		);
	}
}
