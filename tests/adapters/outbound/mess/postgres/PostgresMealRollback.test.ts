import { describe, it, expect, beforeEach, vi } from "vitest";
import { newDb } from "pg-mem";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { PostgresMealRollback } from "../../../../../src/adapters/outbound/mess/postgres/PostgresMealRollback";
import {
	messMeals,
	whatsappGroupFoodAnnouncementsMessages,
} from "../../../../../src/adapters/outbound/mess/postgres/schema";
import { LoggerPort } from "../../../../../src/core/ports/LoggerPort";

describe("PostgresMealRollback", () => {
	let db: NodePgDatabase;
	let rollback: PostgresMealRollback;
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
		rollback = new PostgresMealRollback(db as any, mockLogger);
	});

	it("executes atomicUndo restoring swapped items and resetting message to pending", async () => {
		const messageId = "msg-undo-1";
		await db.execute(`
      INSERT INTO whatsapp_group_food_announcements_messages (id, sender_address, sender_address_type, message_type, status, processed_at)
      VALUES ('${messageId}', '+919999999999@s.whatsapp.net', 'pn', 'text', 'processed', now());

      INSERT INTO mess_meals (id, meal_date, meal_slot, vendor, items, source_message_id)
      VALUES ('a0000000-0000-0000-0000-000000000001', '2026-10-21', 'lunch', 'cheftalk_regular', ARRAY['New Items'], '${messageId}');

      INSERT INTO mess_meal_changes (id, meal_date, meal_slot, target_vendor, change_type, affected_item, original_item, source_message_id)
      VALUES ('b0000000-0000-0000-0000-000000000001', '2026-10-21', 'lunch', 'cheftalk_regular', 'replacement', 'Swapped Menu', '["Original Items"]', '${messageId}');
    `);

		await rollback.atomicUndo(messageId);

		// Meals inserted by sourceMessageId should be deleted
		const meals = await db.select().from(messMeals).where(eq(messMeals.sourceMessageId, messageId));
		expect(meals).toHaveLength(0);

		// Message status should be reset to pending
		const [msg] = await db
			.select()
			.from(whatsappGroupFoodAnnouncementsMessages)
			.where(eq(whatsappGroupFoodAnnouncementsMessages.id, messageId));
		expect(msg.status).toBe("pending");
		expect(msg.processedAt).toBeNull();
	});

	it("executes atomicReset clearing operational tables and resetting staging messages", async () => {
		await db.execute(`
      INSERT INTO whatsapp_group_food_announcements_messages (id, sender_address, sender_address_type, message_type, status, processed_at)
      VALUES ('msg-reset-1', '+919999999999@s.whatsapp.net', 'pn', 'text', 'processed', now());

      INSERT INTO mess_meals (id, meal_date, meal_slot, vendor, items)
      VALUES ('a0000000-0000-0000-0000-000000000001', '2026-10-21', 'lunch', 'cheftalk_regular', ARRAY['Items']);
    `);

		await rollback.atomicReset();

		const meals = await db.select().from(messMeals);
		expect(meals).toHaveLength(0);

		const [msg] = await db.select().from(whatsappGroupFoodAnnouncementsMessages);
		expect(msg.status).toBe("pending");
		expect(msg.processedAt).toBeNull();
	});
});
