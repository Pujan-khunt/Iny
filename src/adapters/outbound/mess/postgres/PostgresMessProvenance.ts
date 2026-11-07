import { and, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type {
	CommitOperationalPayload,
	ResolvedMealSwapInput,
} from "../../../../core/entities/MessCommit";
import type { MealSlot } from "../../../../core/entities/MessMeal";
import {
	messMeals,
	messIngestionOperationAudits as audits,
	foodAnnouncementIngestions as work,
} from "./schema";

const list = <T>(value?: T | T[]): T[] =>
	value === undefined ? [] : Array.isArray(value) ? value : [value];

/** Reads accepted operation ownership and operational prerequisites inside the caller transaction. */
export class PostgresMessProvenance {
	/**
	 * @param payload Existing manual/automatic operational payload and explicit meal vendors.
	 * @param swaps Resolved swap targets; returns deduplicated keys, throws for absent vendor.
	 */
	static factKeys(
		payload: CommitOperationalPayload,
		swaps: readonly ResolvedMealSwapInput[] = [],
	): string[] {
		const keys = [...this.menuKeys(payload), ...this.operationalKeys(payload)];
		for (const swap of swaps) {
			keys.push(`menu/${swap.targetMealDate}/${swap.targetMealSlot}/${swap.vendor}`);
			keys.push(`change/${swap.targetMealDate}/${swap.targetMealSlot}/${swap.vendor}`);
		}
		return [...new Set(keys)];
	}

	private static menuKeys(payload: CommitOperationalPayload): string[] {
		const keys = (payload.weeklyMenu?.meals ?? []).map(
			(meal) => `menu/${meal.mealDate}/${meal.mealSlot}/${payload.weeklyMenu!.vendor}`,
		);
		for (const meal of payload.meals ?? []) {
			const vendor = meal.vendor ?? payload.vendor;
			if (!vendor) throw new Error("A meal fact key requires an explicit vendor");
			keys.push(`menu/${meal.mealDate}/${meal.mealSlot}/${vendor}`);
		}
		return keys;
	}

	private static operationalKeys(payload: CommitOperationalPayload): string[] {
		const keys: string[] = [];
		for (const row of list(payload.locationDetails ?? payload.locationDetail))
			keys.push(`location/${row.mealDate}/${row.mealSlot ?? "lunch"}`);
		for (const row of list(payload.timingExtensions ?? payload.timingExtension))
			keys.push(`timing/${row.mealDate}/${row.mealSlot}`);
		for (const row of list(payload.mealChanges ?? payload.mealChange))
			keys.push(`change/${row.mealDate}/${row.mealSlot}/${row.targetVendor}`);
		return keys;
	}

	/**
	 * @param tx Caller transaction holding the write lock; SQL failures reject.
	 * @param keys Affected keys; returns active audits and current-row trusted provenance.
	 * Synthetic staging timestamps are never trusted; unknown provenance remains null.
	 */
	async owners(tx: PgDatabase<PgQueryResultHKT, Record<string, unknown>>, keys: readonly string[]) {
		if (keys.length === 0) return [];
		const wanted = sql`ARRAY[${sql.join(
			keys.map((key) => sql`${key}`),
			sql`, `,
		)}]::text[]`;
		return tx.select({
			key: sql<string>`ownership.key`,
			messageId: sql<string | null>`ownership."messageId"`,
			originalCreatedAt: sql<string | null>`ownership."originalCreatedAt"`,
		}).from(sql`(
			WITH current_facts AS (
				SELECT concat('menu/', meal_date, '/', meal_slot, '/', vendor) AS key, source_message_id FROM mess_meals
				UNION ALL SELECT concat('location/', meal_date, '/', meal_slot), source_message_id FROM mess_meal_location_details
				UNION ALL SELECT concat('timing/', meal_date, '/', meal_slot), source_message_id FROM mess_meal_timing_extensions
				UNION ALL SELECT concat('change/', meal_date, '/', meal_slot, '/', target_vendor), source_message_id FROM mess_meal_changes
			), active_audits AS (
				SELECT unnest(affected_fact_keys) AS key, source_message_id, original_created_at FROM ${audits} WHERE reversed_at IS NULL
			)
			SELECT key, source_message_id AS "messageId", original_created_at AS "originalCreatedAt" FROM active_audits WHERE key = ANY(${wanted})
			UNION ALL
			SELECT current_facts.key, current_facts.source_message_id AS "messageId",
				coalesce(${work.originalCreatedAt}, provenance.original_created_at) AS "originalCreatedAt"
			FROM current_facts LEFT JOIN ${work} ON ${work.messageId} = current_facts.source_message_id
			LEFT JOIN LATERAL (
				SELECT max(original_created_at) AS original_created_at FROM active_audits
				WHERE active_audits.key = current_facts.key AND active_audits.source_message_id = current_facts.source_message_id
			) provenance ON true WHERE current_facts.key = ANY(${wanted})) ownership`);
	}

	/**
	 * @param tx Caller transaction; SQL failures reject.
	 * @param date ISO endpoint date. @param slot Endpoint slot.
	 * @returns Every current vendor row; the guard applies the original announced scope.
	 */
	async meals(
		tx: PgDatabase<PgQueryResultHKT, Record<string, unknown>>,
		date: string,
		slot: MealSlot,
	) {
		return tx
			.select()
			.from(messMeals)
			.where(and(eq(messMeals.mealDate, date), eq(messMeals.mealSlot, slot)));
	}
}
