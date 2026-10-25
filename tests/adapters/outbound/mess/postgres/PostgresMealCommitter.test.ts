import { describe, it, expect, beforeEach, vi } from "vitest";
import { newDb } from "pg-mem";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { PostgresMealCommitter } from "../../../../../src/adapters/outbound/mess/postgres/PostgresMealCommitter";
import { LoggerPort } from "../../../../../src/core/ports/LoggerPort";

describe("PostgresMealCommitter", () => {
	let db: NodePgDatabase;
	let committer: PostgresMealCommitter;
	const mockLogger: LoggerPort = {
		trace: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis(),
	} as unknown as LoggerPort;

	beforeEach(() => {
		vi.clearAllMocks();

		const memDb = newDb();
		memDb.public.none(`
      CREATE TYPE meal_slot AS ENUM ('breakfast', 'lunch', 'dinner');
      CREATE TYPE vendor AS ENUM ('cheftalk_regular', 'cheftalk_jain', 'tcb');
      CREATE TYPE meal_change_type AS ENUM ('replacement', 'addition', 'cancellation');
      CREATE TYPE food_announcement_status AS ENUM ('pending', 'processed', 'ignored');
      CREATE TYPE food_announcement_message_type AS ENUM ('image', 'document', 'text');
      CREATE TYPE sender_address_type AS ENUM ('pn', 'lid');

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

      CREATE TABLE mess_meal_location_details (
        id UUID PRIMARY KEY,
        meal_date DATE NOT NULL,
        meal_slot meal_slot NOT NULL DEFAULT 'lunch',
        hostel_batches TEXT[] NOT NULL,
        college_batches TEXT[] NOT NULL,
        source_message_id TEXT,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_mess_location UNIQUE (meal_date, meal_slot)
      );

      CREATE TABLE mess_meal_timing_extensions (
        id UUID PRIMARY KEY,
        meal_date DATE NOT NULL,
        meal_slot meal_slot NOT NULL,
        target_vendor vendor,
        extended_timings TEXT NOT NULL,
        source_message_id TEXT,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

      CREATE TABLE whatsapp_group_food_announcements_messages (
        id TEXT PRIMARY KEY,
        sender_address TEXT NOT NULL,
        sender_address_type sender_address_type NOT NULL,
        message_type food_announcement_message_type NOT NULL,
        media_mime_type TEXT,
        media_buffer BYTEA,
        text_body TEXT,
        status food_announcement_status NOT NULL DEFAULT 'pending',
        received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        processed_at TIMESTAMPTZ
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
		committer = new PostgresMealCommitter(db as any, mockLogger);
	});

	it("commits operational meals atomically and retrieves via getMealsByDateAndSlot", async () => {
		const messageId = "msg-commit-1";
		await db.execute(`
      INSERT INTO whatsapp_group_food_announcements_messages (id, sender_address, sender_address_type, message_type, status)
      VALUES ('${messageId}', '+919999999999@s.whatsapp.net', 'pn', 'text', 'pending');
    `);

		await committer.atomicCommit({
			messageId,
			vendor: "cheftalk_regular",
			meals: [
				{
					mealDate: "2026-10-21",
					mealSlot: "lunch",
					items: ["Dal Makhani", "Rice", "Roti"],
				},
			],
		});

		const meals = await committer.getMealsByDateAndSlot("2026-10-21", "lunch", "cheftalk_regular");
		expect(meals).toHaveLength(1);
		expect(meals[0].items).toEqual(["Dal Makhani", "Rice", "Roti"]);
		expect(meals[0].vendor).toBe("cheftalk_regular");
	});

	it("commits composite announcements with resolved swaps atomically", async () => {
		const messageId = "msg-composite-1";
		await db.execute(`
      INSERT INTO whatsapp_group_food_announcements_messages (id, sender_address, sender_address_type, message_type, status)
      VALUES ('${messageId}', '+919999999999@s.whatsapp.net', 'pn', 'text', 'pending');
      INSERT INTO mess_meals (id, meal_date, meal_slot, vendor, items)
      VALUES ('a0000000-0000-0000-0000-000000000001', '2026-10-21', 'dinner', 'cheftalk_regular', ARRAY['Old Dinner']);
    `);

		await committer.atomicCommitComposite({
			messageId,
			composite: {
				mealDate: "2026-10-21",
				location: {
					mealDate: "2026-10-21",
					mealSlot: "lunch",
					hostelBatches: ["BH-1"],
					collegeBatches: ["UG2"],
				},
				timingExtensions: [
					{
						mealDate: "2026-10-21",
						mealSlot: "dinner",
						targetVendor: "cheftalk_regular",
						extendedTimings: "Until 10:30 PM",
					},
				],
				mealChanges: [],
			},
			resolvedSwaps: [
				{
					targetMealDate: "2026-10-21",
					targetMealSlot: "dinner",
					vendor: "cheftalk_regular",
					newItems: ["New Dinner Special"],
					previousItems: ["Old Dinner"],
					sourceMealDate: "2026-10-22",
					sourceMealSlot: "dinner",
				},
			],
		});

		const updatedMeals = await committer.getMealsByDateAndSlot(
			"2026-10-21",
			"dinner",
			"cheftalk_regular",
		);
		expect(updatedMeals[0].items).toEqual(["New Dinner Special"]);
	});
});
