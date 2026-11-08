import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";
import { DataType, newDb } from "pg-mem";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { PostgresSwapWriter } from "../../../../../src/adapters/outbound/mess/postgres/PostgresSwapWriter";
import {
	messMeals,
	messMealChanges,
} from "../../../../../src/adapters/outbound/mess/postgres/schema";
import { eq } from "drizzle-orm";

describe("PostgresSwapWriter", () => {
	let db: NodePgDatabase;
	let swapWriter: PostgresSwapWriter;

	beforeEach(async () => {
		const memDb = newDb();
		memDb.public.registerFunction({
			name: "gen_random_uuid",
			returns: DataType.uuid,
			implementation: randomUUID,
			impure: true,
		});

		memDb.public.none(`
			CREATE TYPE meal_slot AS ENUM ('breakfast', 'lunch', 'dinner');
			CREATE TYPE vendor AS ENUM ('cheftalk_regular', 'cheftalk_jain', 'tcb');
			CREATE TYPE meal_change_type AS ENUM ('replacement', 'addition', 'cancellation');

			CREATE TABLE mess_meals (
				id UUID PRIMARY KEY,
				meal_date DATE NOT NULL,
				meal_slot meal_slot NOT NULL,
				vendor vendor NOT NULL,
				items TEXT[] NOT NULL,
				source_message_id TEXT,
				ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_mess_meals UNIQUE (meal_date, meal_slot, vendor)
			);

			CREATE TABLE mess_meal_changes (
				id UUID PRIMARY KEY,
				meal_date DATE NOT NULL,
				meal_slot meal_slot NOT NULL,
				target_vendor vendor NOT NULL,
				change_type meal_change_type NOT NULL,
				affected_item TEXT NOT NULL,
				original_item TEXT,
				source_message_id TEXT,
				ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
			);
		`);

		const { Pool } = memDb.adapters.createPg();
		const pool = new Pool();
		const origQuery = pool.query.bind(pool);
		pool.query = async function (queryTextOrConfig: any, values: any, callback: any) {
			let isRowModeArray = false;
			if (typeof queryTextOrConfig === "object" && queryTextOrConfig !== null) {
				if (queryTextOrConfig.rowMode === "array") {
					isRowModeArray = true;
					delete queryTextOrConfig.rowMode;
				}
				delete queryTextOrConfig.types;
			}
			const result = await origQuery(queryTextOrConfig, values, callback);
			if (isRowModeArray && result && Array.isArray(result.rows)) {
				result.rows = result.rows.map((row: any) => Object.values(row));
			}
			return result;
		};

		db = drizzle(pool);
		swapWriter = new PostgresSwapWriter();

		await db.insert(messMeals).values({
			id: randomUUID(),
			mealDate: "2026-10-05",
			mealSlot: "breakfast",
			vendor: "cheftalk_regular",
			items: ["Upma", "Chutney"],
			sourceMessageId: "init-msg",
			ingestedAt: new Date(),
		});
	});

	it("formats source meal date using natural English format in affectedItem", async () => {
		await swapWriter.commitSwaps(db, "swap-msg-1", [
			{
				sourceMealDate: "2026-10-04",
				sourceMealSlot: "breakfast",
				targetMealDate: "2026-10-05",
				targetMealSlot: "breakfast",
				vendor: "cheftalk_regular",
				newItems: ["Poha", "Sev"],
				previousItems: ["Upma", "Chutney"],
			},
		]);

		const changes = await db
			.select()
			.from(messMealChanges)
			.where(eq(messMealChanges.sourceMessageId, "swap-msg-1"));

		expect(changes).toHaveLength(1);
		expect(changes[0].affectedItem).toBe("Sunday, 4th Oct breakfast Menu (Poha, Sev)");
	});

	it("throws when previousItems backup is empty", async () => {
		await expect(
			swapWriter.commitSwaps(db, "swap-msg-2", [
				{
					sourceMealDate: "2026-10-04",
					sourceMealSlot: "breakfast",
					targetMealDate: "2026-10-05",
					targetMealSlot: "breakfast",
					vendor: "cheftalk_regular",
					newItems: ["Poha"],
					previousItems: [],
				},
			]),
		).rejects.toThrow("previousItems backup must not be empty");
	});
});
