import { describe, it, expect, beforeEach, vi } from "vitest";
import { newDb } from "pg-mem";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { PostgresStagingQueue } from "../../../../../src/adapters/outbound/mess/postgres/PostgresStagingQueue";
import { LoggerPort } from "../../../../../src/core/ports/LoggerPort";

describe("PostgresStagingQueue", () => {
	let db: NodePgDatabase;
	let queue: PostgresStagingQueue;
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
      CREATE TYPE food_announcement_status AS ENUM ('pending', 'processed', 'ignored');
      CREATE TYPE food_announcement_message_type AS ENUM ('image', 'document', 'text');
      CREATE TYPE sender_address_type AS ENUM ('pn', 'lid');

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
		queue = new PostgresStagingQueue(db as any, mockLogger);
	});

	it("stages a message and retrieves it by id", async () => {
		const result = await queue.stageMessage({
			id: "msg-1",
			senderAddress: "+919876543210@s.whatsapp.net",
			senderAddressType: "pn",
			messageType: "text",
			textBody: "Lunch menu announcement",
		});
		expect(result).toBe("staged");

		const message = await queue.getMessageById("msg-1");
		expect(message).not.toBeNull();
		expect(message?.id).toBe("msg-1");
		expect(message?.textBody).toBe("Lunch menu announcement");
		expect(message?.status).toBe("pending");

		const duplicateResult = await queue.stageMessage({
			id: "msg-1",
			senderAddress: "+919876543210@s.whatsapp.net",
			senderAddressType: "pn",
			messageType: "text",
			textBody: "Duplicate announcement",
		});
		expect(duplicateResult).toBe("already_staged");
	});

	it("returns null for non-existent message id", async () => {
		const message = await queue.getMessageById("non-existent");
		expect(message).toBeNull();
	});

	it("lists staged messages with pagination and filtering", async () => {
		const baseDate = new Date("2026-10-21T10:00:00+05:30");
		await queue.stageMessage({
			id: "msg-1",
			senderAddress: "+919876543210@s.whatsapp.net",
			senderAddressType: "pn",
			messageType: "text",
			textBody: "Msg 1",
			receivedAt: baseDate,
		});

		await queue.stageMessage({
			id: "msg-2",
			senderAddress: "+919876543210@s.whatsapp.net",
			senderAddressType: "pn",
			messageType: "text",
			textBody: "Msg 2",
			receivedAt: new Date(baseDate.getTime() + 1000),
		});

		const list = await queue.listStagedMessages({ limit: 10, date: "2026-10-21" });
		expect(list).toHaveLength(2);
		expect(list[0].id).toBe("msg-2");
		expect(list[1].id).toBe("msg-1");
	});

	it("marks a message as ignored", async () => {
		await queue.stageMessage({
			id: "msg-ignore-1",
			senderAddress: "+919876543210@s.whatsapp.net",
			senderAddressType: "pn",
			messageType: "text",
			textBody: "Spam message",
		});

		await queue.markIgnored("msg-ignore-1");
		const message = await queue.getMessageById("msg-ignore-1");
		expect(message?.status).toBe("ignored");
	});
});
