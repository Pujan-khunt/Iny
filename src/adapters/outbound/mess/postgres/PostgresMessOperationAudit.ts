import { and, eq, inArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type {
	CommitOperationalPayload,
	ResolvedMealSwapInput,
} from "../../../../core/entities/MessCommit";
import type { MealSlot } from "../../../../core/entities/MessMeal";
import type { MenuCorrection } from "../../../../core/entities/MessAnnouncement";
import type { MessCommitOperation } from "./PostgresMessCommitPreparation";
import { PostgresMessProvenance } from "./PostgresMessProvenance";
import {
	messMeals,
	messMealLocationDetails,
	messMealTimingExtensions,
	messMealChanges,
	messIngestionOperationAudits as audits,
	foodAnnouncementIngestions as work,
	whatsappGroupFoodAnnouncementsMessages as staging,
} from "./schema";

type Transaction = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;
/** Immutable operation evidence and snapshots, plus delegated trusted provenance reads. */
export class PostgresMessOperationAudit {
	/** @param provenance Injected fact ownership and endpoint reader. */
	constructor(private readonly provenance: PostgresMessProvenance) {}
	/** Returns stable affected keys, throwing if a meal has no explicit vendor. */
	static factKeys(payload: CommitOperationalPayload, swaps: readonly ResolvedMealSwapInput[] = []) {
		return PostgresMessProvenance.factKeys(payload, swaps);
	}
	/** Reads active owners under the caller's write lock; SQL failures reject. */
	owners(tx: Transaction, keys: readonly string[]) {
		return this.provenance.owners(tx, keys);
	}
	/** Reads every current endpoint vendor; SQL failures reject. */
	meals(tx: Transaction, date: string, slot: MealSlot) {
		return this.provenance.meals(tx, date, slot);
	}
	/** Reads immutable raw source and trustworthy original time, never a staging fallback. */
	async source(tx: Transaction, messageId: string) {
		const [row] = await tx
			.select({ source: staging, originalCreatedAt: work.originalCreatedAt })
			.from(staging)
			.leftJoin(work, eq(work.messageId, staging.id))
			.where(eq(staging.id, messageId));
		return row;
	}
	/** Captures complete rows, including provenance, by stable fact key; SQL failures reject. */
	async snapshot(tx: Transaction, keys: readonly string[]) {
		const images: Record<string, unknown[]> = {};
		for (const key of keys) {
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
			images[key] = await tx
				.select()
				.from(table)
				.where(and(eq(table.mealDate, date), eq(table.mealSlot, slot as MealSlot), scope));
		}
		return images;
	}
	/** Captures affected facts plus untouched swap sources to preserve both endpoint provenances. */
	operationSnapshot(
		tx: Transaction,
		keys: readonly string[],
		swaps: readonly ResolvedMealSwapInput[] = [],
	) {
		const sources = swaps.map(
			(row) => `menu/${row.sourceMealDate}/${row.sourceMealSlot}/${row.vendor}`,
		);
		return this.snapshot(tx, [...new Set([...keys, ...sources])]);
	}

	/** Terminalizes only outstanding automation; existing decisions and diagnostics stay immutable. */
	async manualDisposition(
		tx: Transaction,
		reason: "manual_override" | "manual_reset",
		messageId?: string,
	) {
		await tx
			.update(work)
			.set({
				state: "rejected",
				decisionReason: reason,
				decisionDetail: "Explicit manual operation",
				completedAt: sql`clock_timestamp()`,
				leaseToken: null,
				leaseExpiresAt: null,
				nextAttemptAt: null,
			})
			.where(
				and(
					inArray(work.state, ["queued", "processing"]),
					messageId === undefined ? undefined : eq(work.messageId, messageId),
				),
			);
	}

	/** Writes accepted operation evidence only, never an automatic decision; SQL failures reject. */
	async record(
		tx: Transaction,
		input: {
			operation: MessCommitOperation;
			originalCreatedAt: Date | null;
			source: unknown;
			keys: string[];
			corrections: readonly MenuCorrection[];
			beforeImages: Record<string, unknown[]>;
			afterImages: Record<string, unknown[]>;
		},
	) {
		const { operation, source, originalCreatedAt, keys, beforeImages, afterImages } = input;
		const extraction = operation.payload.extractionAudit;
		await tx.insert(audits).values({
			sourceMessageId: operation.messageId,
			originalCreatedAt,
			mode: operation.mode,
			affectedFactKeys: keys,
			beforeImages,
			afterImages,
			extractionEvidence: {
				source,
				extractionAudit: extraction,
				assessment: operation.extractionEvidence,
			},
			reviewEvidence: {
				...operation.payload,
				swaps: operation.swaps,
				resolvedSwaps: operation.resolvedSwaps,
			},
			corrections: {
				initial: extraction?.corrections ?? [],
				review: extraction?.reviewCorrections ?? [],
				commit: input.corrections,
			},
		});
	}
}
