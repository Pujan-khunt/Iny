import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { MealSlot } from "../../../../core/entities/MessMeal";
import { PostgresMessOperationAudit } from "./PostgresMessOperationAudit";
import {
	messMeals,
	messMealLocationDetails,
	messMealTimingExtensions,
	messMealChanges,
	messIngestionOperationAudits as audits,
} from "./schema";
type Transaction = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;
type Images = Record<string, Record<string, unknown>[]>;

/** Restores whole audited operations only while every recorded after-image remains current. */
export class PostgresMessAuditRestorer {
	/** Injects the snapshot reader; the caller owns the transaction and shared write lock. */
	constructor(private readonly audit: PostgresMessOperationAudit) {}

	/** Returns false only for unaudited legacy sources; changed or already reversed audits throw. */
	async restore(tx: Transaction, messageId: string): Promise<boolean> {
		const history = await tx
			.select()
			.from(audits)
			.where(eq(audits.sourceMessageId, messageId))
			.orderBy(desc(audits.createdAt));
		if (!history.length) return false;
		const active = history.filter((row) => row.reversedAt === null);
		if (active.length !== 1) throw new Error("No unique active operation to undo");
		const operation = active[0];
		const before = this.images(operation.beforeImages);
		const after = this.images(operation.afterImages);
		if (!isDeepStrictEqual(Object.keys(before).sort(), Object.keys(after).sort()))
			throw new Error("Incomplete operation snapshots");
		const current = await this.audit.snapshot(tx, Object.keys(after));
		for (const key of Object.keys(after)) {
			if (!this.equal(current[key], after[key]))
				throw new Error(`Changed owner or after-image for ${key}`);
		}
		for (const key of operation.affectedFactKeys) {
			if (!Object.hasOwn(before, key)) throw new Error("Missing affected snapshot");
		}
		for (const key of operation.affectedFactKeys) await this.replace(tx, key, before[key]);
		await tx
			.update(audits)
			.set({ reversedAt: sql`clock_timestamp()`, reversalReason: "manual_undo" })
			.where(eq(audits.operationId, operation.operationId));
		return true;
	}

	private images(value: unknown): Images {
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw new Error("Invalid operation snapshots");
		for (const rows of Object.values(value)) {
			if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== "object"))
				throw new Error("Invalid operation snapshot rows");
		}
		return value as Images;
	}
	private equal(current: unknown[], expected: unknown[]) {
		const sorted = (rows: unknown[]) =>
			JSON.parse(JSON.stringify(rows)).sort((a: { id: string }, b: { id: string }) =>
				a.id.localeCompare(b.id),
			);
		return isDeepStrictEqual(sorted(current), sorted(expected));
	}
	private async replace(tx: Transaction, key: string, rows: Record<string, unknown>[]) {
		const [kind, date, slot, vendor] = key.split("/");
		const table = {
			menu: messMeals,
			location: messMealLocationDetails,
			timing: messMealTimingExtensions,
			change: messMealChanges,
		}[kind];
		if (!table) throw new Error(`Unknown fact key ${key}`);
		const scope = vendor
			? sql`${kind === "menu" ? messMeals.vendor : messMealChanges.targetVendor} = ${vendor}`
			: undefined;
		await tx
			.delete(table)
			.where(and(eq(table.mealDate, date), eq(table.mealSlot, slot as MealSlot), scope));
		if (!rows.length) return;
		const columns = getTableColumns(table);
		const restored = rows.map((row) =>
			Object.fromEntries(
				Object.entries(row).map(([field, value]) => [
					field,
					columns[field as keyof typeof columns]?.dataType === "date" && value !== null
						? new Date(value as string)
						: value,
				]),
			),
		);
		await tx.insert(table).values(restored as (typeof messMeals.$inferSelect)[]);
	}
}
