import { and, eq, notInArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { LoggerPort } from "../../../../core/ports/LoggerPort";
import type { PostgresMessWriteGuard } from "./PostgresMessWriteGuard";
import type { PostgresMessOperationAudit } from "./PostgresMessOperationAudit";
import type { PostgresMessAuditRestorer } from "./PostgresMessAuditRestorer";
import {
	messMeals,
	messMealLocationDetails,
	messMealTimingExtensions,
	messMealChanges,
	whatsappGroupFoodAnnouncementsMessages as staging,
} from "./schema";
type Transaction = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

/** Coordinates explicit safe undo/reset and automation tombstones under the shared write lock. */
export class PostgresMealRollback {
	/** Injects database, logger, lock, complete snapshot restorer and automation audit collaborator. */
	constructor(
		private readonly db: Transaction,
		private readonly logger: LoggerPort,
		private readonly guard: PostgresMessWriteGuard,
		private readonly restorer: PostgresMessAuditRestorer,
		private readonly audit: PostgresMessOperationAudit,
	) {}

	/** Restores audited before-images or surgically undoes legacy rows; unsafe ownership throws atomically. */
	async atomicUndo(messageId: string): Promise<void> {
		await this.db.transaction(async (tx) => {
			await this.guard.lock(tx);
			if (!(await this.restorer.restore(tx, messageId))) await this.legacyUndo(tx, messageId);
			await this.audit.manualDisposition(tx, "manual_override", messageId);
			await tx
				.update(staging)
				.set({ status: "pending", processedAt: null })
				.where(eq(staging.id, messageId));
		});
		this.logger.info("Successfully completed explicit undo", { messageId });
	}

	private async legacyUndo(tx: Transaction, messageId: string) {
		const changes = await tx
			.select()
			.from(messMealChanges)
			.where(eq(messMealChanges.sourceMessageId, messageId));
		const backups = [];
		for (const change of changes) {
			if (!change.originalItem?.startsWith("[")) continue;
			const items: unknown = JSON.parse(change.originalItem);
			if (!Array.isArray(items) || !items.every((item) => typeof item === "string"))
				throw new Error("Invalid legacy swap backup");
			const scope = and(
				eq(messMeals.mealDate, change.mealDate),
				eq(messMeals.mealSlot, change.mealSlot),
				eq(messMeals.vendor, change.targetVendor),
			);
			const [current] = await tx.select().from(messMeals).where(scope);
			if (!current || current.sourceMessageId !== messageId)
				throw new Error("Cannot establish current legacy swap ownership/provenance");
			backups.push({ id: current.id, scope, items: items as string[] });
		}
		for (const backup of backups)
			await tx.update(messMeals).set({ items: backup.items }).where(backup.scope);
		await tx.delete(messMeals).where(
			and(
				eq(messMeals.sourceMessageId, messageId),
				notInArray(
					messMeals.id,
					backups.map((backup) => backup.id),
				),
			),
		);
		for (const table of [messMealLocationDetails, messMealTimingExtensions, messMealChanges])
			await tx.delete(table).where(eq(table.sourceMessageId, messageId));
	}

	/** Resets only operational/staging data and terminalizes outstanding work; activation/final decisions survive. */
	async atomicReset(): Promise<void> {
		await this.db.transaction(async (tx) => {
			await this.guard.lock(tx);
			await this.audit.manualDisposition(tx, "manual_reset");
			for (const table of [
				messMeals,
				messMealLocationDetails,
				messMealTimingExtensions,
				messMealChanges,
			])
				await tx.delete(table);
			await tx.update(staging).set({ status: "pending", processedAt: null });
		});
		this.logger.warn("Successfully completed development reset");
	}
}
