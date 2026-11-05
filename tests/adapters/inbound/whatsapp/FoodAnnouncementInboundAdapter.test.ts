import { DirectMessageInboundAdapter } from "../../../../src/adapters/inbound/whatsapp/DirectMessageInboundAdapter";
import { HandleIncomingUserMessage } from "../../../../src/core/use-cases/HandleIncomingUserMessage";
import { AgentLoop } from "../../../../src/core/services/AgentLoop";
import { InMemoryToolRegistry } from "../../../../src/adapters/outbound/tool-registry/InMemoryToolRegistry";
import type { AccessControlPort } from "../../../../src/core/ports/AccessControlPort";
import type { DialogueTurnRepositoryPort } from "../../../../src/core/ports/DialogueTurnRepositoryPort";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { WAMessage } from "@whiskeysockets/baileys";
import { StageIncomingFoodAnnouncement } from "../../../../src/core/use-cases/StageIncomingFoodAnnouncement";
import { WhatsAppMessageNormalizer } from "../../../../src/adapters/inbound/whatsapp/router/WhatsAppMessageNormalizer";
import { WhatsAppMessageContentExtractor } from "../../../../src/adapters/inbound/whatsapp/router/WhatsAppMessageContentExtractor";
import { WhatsAppMessageRouter } from "../../../../src/adapters/inbound/whatsapp/router/WhatsAppMessageRouter";
import { PostgresFoodAdmission } from "../../../../src/adapters/outbound/mess/postgres/PostgresFoodAdmission";
import { PostgresFoodIngestionRepository } from "../../../../src/adapters/outbound/mess/postgres/PostgresFoodIngestionRepository";
import { PostgresFoodWorkQueue } from "../../../../src/adapters/outbound/mess/postgres/PostgresFoodWorkQueue";
import { PostgresFoodFinalizer } from "../../../../src/adapters/outbound/mess/postgres/PostgresFoodFinalizer";
import { PostgresMealCommitter } from "../../../../src/adapters/outbound/mess/postgres/PostgresMealCommitter";
import { PostgresMessWriteGuard } from "../../../../src/adapters/outbound/mess/postgres/PostgresMessWriteGuard";
import { PostgresMessOperationAudit } from "../../../../src/adapters/outbound/mess/postgres/PostgresMessOperationAudit";
import { PostgresMessProvenance } from "../../../../src/adapters/outbound/mess/postgres/PostgresMessProvenance";
import { PostgresMessCommitPreparation } from "../../../../src/adapters/outbound/mess/postgres/PostgresMessCommitPreparation";
import { PostgresOperationalWriter } from "../../../../src/adapters/outbound/mess/postgres/PostgresOperationalWriter";
import { PostgresSwapWriter } from "../../../../src/adapters/outbound/mess/postgres/PostgresSwapWriter";
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { FoodAnnouncementInboundAdapter } from "../../../../src/adapters/inbound/whatsapp/FoodAnnouncementInboundAdapter";
import { NormalizedWhatsAppMessage } from "../../../../src/adapters/inbound/whatsapp/router/NormalizedWhatsAppMessage";

describe("FoodAnnouncementInboundAdapter", () => {
	const targetGroupJid = "120363045678901234@g.us";

	const createMockUseCase = () => ({
		execute: vi.fn().mockResolvedValue(undefined),
	});

	const createMockLogger = () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis(),
	});

	it("has name food-announcement and accepts notify and append upserts", () => {
		const adapter = new FoodAnnouncementInboundAdapter({
			targetGroupJid,
			useCase: createMockUseCase() as any,
			logger: createMockLogger() as any,
		});

		expect(adapter.name).toBe("food-announcement");
		expect(adapter.acceptedUpsertTypes).toEqual(["notify", "append"]);
	});

	describe("matches", () => {
		it("matches target group document message", () => {
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid,
				useCase: createMockUseCase() as any,
				logger: createMockLogger() as any,
			});

			const msg: NormalizedWhatsAppMessage = {
				messageId: "food-doc-1",
				chatJid: targetGroupJid,
				chatType: "group",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				originalTimestamp: 1793491200000,
				upsertType: "notify",
				content: {
					type: "document",
					text: "menu.pdf",
					mimeType: "application/pdf",
				},
				downloadMedia: vi.fn(),
			};

			expect(adapter.matches(msg)).toBe(true);
		});

		it("matches target group image message", () => {
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid,
				useCase: createMockUseCase() as any,
				logger: createMockLogger() as any,
			});

			const msg: NormalizedWhatsAppMessage = {
				messageId: "food-img-1",
				chatJid: targetGroupJid,
				chatType: "group",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				originalTimestamp: 1793491200000,
				upsertType: "notify",
				content: { type: "image", text: "menu.jpg", mimeType: "image/jpeg" },
				downloadMedia: vi.fn(),
			};

			expect(adapter.matches(msg)).toBe(true);
		});

		it("matches target group text message", () => {
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid,
				useCase: createMockUseCase() as any,
				logger: createMockLogger() as any,
			});

			const msg: NormalizedWhatsAppMessage = {
				messageId: "food-txt-1",
				chatJid: targetGroupJid,
				chatType: "group",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				originalTimestamp: 1793491200000,
				upsertType: "notify",
				content: { type: "text", text: "Dinner is delayed", mimeType: null },
				downloadMedia: vi.fn(),
			};

			expect(adapter.matches(msg)).toBe(true);
		});

		it("rejects text messages with empty or whitespace-only content", () => {
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid,
				useCase: createMockUseCase() as any,
				logger: createMockLogger() as any,
			});

			const emptyMsg: NormalizedWhatsAppMessage = {
				messageId: "food-empty-1",
				chatJid: targetGroupJid,
				chatType: "group",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				originalTimestamp: 1793491200000,
				upsertType: "notify",
				content: { type: "text", text: "", mimeType: null },
				downloadMedia: vi.fn(),
			};

			const whitespaceMsg: NormalizedWhatsAppMessage = {
				...emptyMsg,
				messageId: "food-ws-1",
				content: { type: "text", text: "   \n\t  ", mimeType: null },
			};

			expect(adapter.matches(emptyMsg)).toBe(false);
			expect(adapter.matches(whitespaceMsg)).toBe(false);
		});

		it("rejects message authored by connected bot (fromMe=true)", () => {
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid,
				useCase: createMockUseCase() as any,
				logger: createMockLogger() as any,
			});

			const msg: NormalizedWhatsAppMessage = {
				messageId: "food-from-me",
				chatJid: targetGroupJid,
				chatType: "group",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: true,
				timestamp: Date.now(),
				originalTimestamp: 1793491200000,
				upsertType: "notify",
				content: { type: "text", text: "Bot message", mimeType: null },
				downloadMedia: vi.fn(),
			};

			expect(adapter.matches(msg)).toBe(false);
		});

		it("rejects direct messages and messages from other groups", () => {
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid,
				useCase: createMockUseCase() as any,
				logger: createMockLogger() as any,
			});

			const directMsg: NormalizedWhatsAppMessage = {
				messageId: "dm-1",
				chatJid: "919876543210@s.whatsapp.net",
				chatType: "direct",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				originalTimestamp: 1793491200000,
				upsertType: "notify",
				content: { type: "text", text: "Direct message", mimeType: null },
				downloadMedia: vi.fn(),
			};

			const otherGroupMsg: NormalizedWhatsAppMessage = {
				messageId: "other-grp-1",
				chatJid: "120999999999999999@g.us",
				chatType: "group",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				originalTimestamp: 1793491200000,
				upsertType: "notify",
				content: { type: "text", text: "Other group message", mimeType: null },
				downloadMedia: vi.fn(),
			};

			expect(adapter.matches(directMsg)).toBe(false);
			expect(adapter.matches(otherGroupMsg)).toBe(false);
		});

		it("rejects unsupported message type", () => {
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid,
				useCase: createMockUseCase() as any,
				logger: createMockLogger() as any,
			});

			const unsupportedMsg: NormalizedWhatsAppMessage = {
				messageId: "food-unsupported-1",
				chatJid: targetGroupJid,
				chatType: "group",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				originalTimestamp: 1793491200000,
				upsertType: "notify",
				content: { type: "unsupported", text: null, mimeType: null },
				downloadMedia: vi.fn(),
			};

			expect(adapter.matches(unsupportedMsg)).toBe(false);
		});
	});

	describe("handle", () => {
		it("downloads media and executes StageIncomingFoodAnnouncement for document messages", async () => {
			const mockUseCase = createMockUseCase();
			const mockLogger = createMockLogger();
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid,
				useCase: mockUseCase as any,
				logger: mockLogger as any,
			});

			const fakeBuffer = Buffer.from("pdf-bytes");
			const downloadMedia = vi.fn().mockResolvedValue(fakeBuffer);
			const msg: NormalizedWhatsAppMessage = {
				messageId: "food-doc-1",
				chatJid: targetGroupJid,
				chatType: "group",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				originalTimestamp: 1793491200000,
				upsertType: "notify",
				content: {
					type: "document",
					text: "menu.pdf",
					mimeType: "application/pdf",
				},
				downloadMedia,
			};

			await adapter.handle(msg);

			expect(downloadMedia).toHaveBeenCalledTimes(1);
			expect(mockLogger.debug).toHaveBeenCalledWith(
				"Downloaded media attachment for food announcement",
				{
					messageId: "food-doc-1",
					mediaMimeType: "application/pdf",
					bufferSize: fakeBuffer.length,
				},
			);
			expect(mockUseCase.execute).toHaveBeenCalledWith({
				messageId: "food-doc-1",
				groupJid: targetGroupJid,
				deliveryMode: "notify",
				originalCreatedAt: new Date(1793491200000),
				capturedAt: expect.any(Date),
				senderAddress: "919876543210@s.whatsapp.net",
				senderAddressType: "pn",
				messageType: "document",
				textBody: "menu.pdf",
				mediaMimeType: "application/pdf",
				mediaBytes: fakeBuffer,
			});
		});

		it("downloads media and executes StageIncomingFoodAnnouncement for image messages", async () => {
			const mockUseCase = createMockUseCase();
			const mockLogger = createMockLogger();
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid,
				useCase: mockUseCase as any,
				logger: mockLogger as any,
			});

			const fakeBuffer = Buffer.from("image-bytes");
			const downloadMedia = vi.fn().mockResolvedValue(fakeBuffer);
			const msg: NormalizedWhatsAppMessage = {
				messageId: "food-img-1",
				chatJid: targetGroupJid,
				chatType: "group",
				senderJid: "123456789012345@lid",
				senderType: "lid",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				originalTimestamp: 1793491200000,
				upsertType: "notify",
				content: { type: "image", text: "Menu photo", mimeType: "image/jpeg" },
				downloadMedia,
			};

			await adapter.handle(msg);

			expect(downloadMedia).toHaveBeenCalledTimes(1);
			expect(mockLogger.debug).toHaveBeenCalledWith(
				"Downloaded media attachment for food announcement",
				{
					messageId: "food-img-1",
					mediaMimeType: "image/jpeg",
					bufferSize: fakeBuffer.length,
				},
			);
			expect(mockUseCase.execute).toHaveBeenCalledWith({
				messageId: "food-img-1",
				groupJid: targetGroupJid,
				deliveryMode: "notify",
				originalCreatedAt: new Date(1793491200000),
				capturedAt: expect.any(Date),
				senderAddress: "123456789012345@lid",
				senderAddressType: "lid",
				messageType: "image",
				textBody: "Menu photo",
				mediaMimeType: "image/jpeg",
				mediaBytes: fakeBuffer,
			});
		});

		it("passes mediaBuffer as null for text messages", async () => {
			const mockUseCase = createMockUseCase();
			const mockLogger = createMockLogger();
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid,
				useCase: mockUseCase as any,
				logger: mockLogger as any,
			});

			const downloadMedia = vi.fn().mockResolvedValue(null);
			const msg: NormalizedWhatsAppMessage = {
				messageId: "food-text-1",
				chatJid: targetGroupJid,
				chatType: "group",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				originalTimestamp: 1793491200000,
				upsertType: "notify",
				content: { type: "text", text: "Lunch is ready", mimeType: null },
				downloadMedia,
			};

			await adapter.handle(msg);

			expect(downloadMedia).not.toHaveBeenCalled();
			expect(mockUseCase.execute).toHaveBeenCalledWith({
				messageId: "food-text-1",
				groupJid: targetGroupJid,
				deliveryMode: "notify",
				originalCreatedAt: new Date(1793491200000),
				capturedAt: expect.any(Date),
				senderAddress: "919876543210@s.whatsapp.net",
				senderAddressType: "pn",
				messageType: "text",
				textBody: "Lunch is ready",
				mediaMimeType: null,
				mediaBytes: null,
			});
		});
	});
});

const databaseUrl = process.env.FOOD_INGESTION_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("food transport provenance through atomic admission", () => {
	const group = "120363045678901234@g.us";
	const schemaName = `iny_food_transport_${randomUUID().replaceAll("-", "")}`;
	let admin: ReturnType<typeof postgres>;
	let client: ReturnType<typeof postgres>;
	let repository: PostgresFoodIngestionRepository;
	let router: WhatsAppMessageRouter;
	let sourceSeconds: number;
	let downloader: ReturnType<typeof vi.fn>;
	const logger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis(),
	};
	const sender = { sendMessage: vi.fn().mockResolvedValue(undefined) };
	function raw(id: string, overrides: Partial<WAMessage> = {}): WAMessage {
		return {
			key: { id, remoteJid: group, participant: "123456789012345:1@lid", fromMe: false },
			message: { conversation: "Today dinner is at the hostel." },
			messageTimestamp: sourceSeconds,
			...overrides,
		};
	}
	beforeAll(async () => {
		admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
		await admin.unsafe(`CREATE SCHEMA "${schemaName}"`);
		client = postgres(databaseUrl!, {
			max: 3,
			connection: { search_path: schemaName },
			onnotice: () => {},
		});
		for (const name of ["0005_soft_scalphunter", "0006_automated_food_ingestion"]) {
			const sql = await readFile(`drizzle/migrations/${name}.sql`, "utf8");
			for (const statement of sql.split("--> statement-breakpoint")) {
				await client.unsafe(statement.replaceAll('"public".', `"${schemaName}".`));
			}
		}
		const db = drizzle(client);
		const audit = new PostgresMessOperationAudit(new PostgresMessProvenance());
		const guard = new PostgresMessWriteGuard(audit);
		const committer = new PostgresMealCommitter(
			db,
			logger,
			new PostgresOperationalWriter(),
			new PostgresSwapWriter(),
			guard,
			audit,
			new PostgresMessCommitPreparation(),
		);
		repository = new PostgresFoodIngestionRepository(
			new PostgresFoodAdmission(db),
			new PostgresFoodWorkQueue(db),
			new PostgresFoodFinalizer(db, guard, committer),
		);
	});
	afterAll(async () => {
		if (client) await client.end();
		if (admin) {
			await admin.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
			await admin.end();
		}
	});
	beforeEach(async () => {
		vi.clearAllMocks();
		await client`TRUNCATE food_announcement_ingestions, food_ingestion_settings, whatsapp_group_food_announcements_messages CASCADE`;
		const activated = await repository.initialize(group);
		sourceSeconds = Math.ceil(activated.getTime() / 1000) + 1;
		downloader = vi.fn().mockResolvedValue(Buffer.from("menu"));
		const normalizer = new WhatsAppMessageNormalizer(
			logger,
			new WhatsAppMessageContentExtractor(logger, downloader as any),
		);
		const adapter = new FoodAnnouncementInboundAdapter({
			targetGroupJid: group,
			useCase: new StageIncomingFoodAnnouncement(repository, logger),
			logger,
		});
		const registry = new InMemoryToolRegistry(logger);
		const directUseCase = new HandleIncomingUserMessage(
			sender,
			{ saveTurn: async () => {} } as unknown as DialogueTurnRepositoryPort,
			{ retrieveContext: async () => [] },
			new AgentLoop(
				{ generateResponse: async () => ({ type: "text", content: "DM response" }) },
				registry,
				{ systemPrompt: "Test assistant" },
			),
			registry,
			logger,
		);
		const accessControl = {
			authenticate: async () => ({ pnJid: "919876543210@s.whatsapp.net" }),
		} as unknown as AccessControlPort;
		router = new WhatsAppMessageRouter(normalizer, logger)
			.register(adapter)
			.register(new DirectMessageInboundAdapter(directUseCase, accessControl, logger));
	});
	it("retains a working DM send path while food messages never send", async () => {
		await router.handleUpsert({
			type: "notify",
			messages: [
				raw("dm", {
					key: { id: "dm", remoteJid: "919876543210@s.whatsapp.net" },
					messageTimestamp: undefined,
				}),
			],
		});
		expect(sender.sendMessage).toHaveBeenCalledExactlyOnceWith(
			"919876543210@s.whatsapp.net",
			"DM response",
		);
		expect(await client`SELECT * FROM food_announcement_ingestions`).toHaveLength(0);
	});
	it("preserves exact live original time and LID scope, and redelivery queues only one row", async () => {
		await router.handleUpsert({ type: "notify", messages: [raw("live"), raw("live")] });
		const rows = await client`SELECT * FROM food_announcement_ingestions`;
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			message_id: "live",
			group_jid: group,
			delivery_mode: "notify",
			state: "queued",
			attempt_count: 0,
		});
		expect(new Date(rows[0].original_created_at).getTime()).toBe(sourceSeconds * 1000);
		const [staging] = await client`SELECT * FROM whatsapp_group_food_announcements_messages`;
		expect(staging).toMatchObject({
			sender_address: "123456789012345@lid",
			sender_address_type: "lid",
			text_body: "Today dinner is at the hostel.",
		});
		expect(downloader).not.toHaveBeenCalled();
		expect(sender.sendMessage).not.toHaveBeenCalled();
	});
	it("captures append as ineligible even when subsequently delivered as notify", async () => {
		await router.handleUpsert({ type: "append", messages: [raw("history")] });
		await router.handleUpsert({ type: "notify", messages: [raw("history")] });
		const rows = await client`SELECT * FROM food_announcement_ingestions`;
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			delivery_mode: "append",
			state: "ineligible",
			eligibility_reason: "append_delivery",
		});
		expect(await repository.claimNext()).toBeNull();
		expect(sender.sendMessage).not.toHaveBeenCalled();
	});
	it("keeps missing original time null through admission despite the DM fallback", async () => {
		await router.handleUpsert({
			type: "notify",
			messages: [raw("missing", { messageTimestamp: undefined })],
		});
		const [row] = await client`SELECT * FROM food_announcement_ingestions`;
		expect(row).toMatchObject({
			original_created_at: null,
			state: "ineligible",
			eligibility_reason: "missing_original_timestamp",
		});
		expect(await repository.claimNext()).toBeNull();
	});
	it("never captures bot-authored or wrong-group messages or downloads their media", async () => {
		const attachment = { imageMessage: { caption: "Menu", mimetype: "image/jpeg" } };
		await router.handleUpsert({
			type: "notify",
			messages: [
				raw("bot", { key: { id: "bot", remoteJid: group, fromMe: true }, message: attachment }),
				raw("wrong", { key: { id: "wrong", remoteJid: "other@g.us" }, message: attachment }),
			],
		});
		expect(await client`SELECT * FROM food_announcement_ingestions`).toHaveLength(0);
		expect(await client`SELECT * FROM whatsapp_group_food_announcements_messages`).toHaveLength(0);
		expect(downloader).not.toHaveBeenCalled();
		expect(sender.sendMessage).not.toHaveBeenCalled();
	});
	it("retries failed media download on redelivery without capturing the caption alone", async () => {
		const message = raw("media", {
			message: { imageMessage: { caption: "Today dinner changed", mimetype: "image/jpeg" } },
		});
		downloader.mockRejectedValueOnce(new Error("disconnected"));
		await router.handleUpsert({ type: "notify", messages: [message] });
		expect(await client`SELECT * FROM whatsapp_group_food_announcements_messages`).toHaveLength(0);
		expect(await client`SELECT * FROM food_announcement_ingestions`).toHaveLength(0);
		expect(logger.error).toHaveBeenCalledWith(
			"Food announcement handling failed",
			expect.any(Error),
			{ messageId: "media", phase: "download" },
		);
		await router.handleUpsert({ type: "notify", messages: [message] });
		const [row] = await client`SELECT * FROM whatsapp_group_food_announcements_messages`;
		expect(row.media_buffer).toEqual(Buffer.from("menu"));
		expect(
			await client`SELECT * FROM food_announcement_ingestions WHERE state = 'queued'`,
		).toHaveLength(1);
		expect(sender.sendMessage).not.toHaveBeenCalled();
	});
	it("rolls back failed capture and admits the same transport ID on retry", async () => {
		await client`ALTER TABLE food_announcement_ingestions ADD CONSTRAINT reject_capture CHECK (message_id <> 'retry')`;
		await router.handleUpsert({ type: "notify", messages: [raw("retry")] });
		expect(await client`SELECT * FROM whatsapp_group_food_announcements_messages`).toHaveLength(0);
		expect(logger.error).toHaveBeenCalledWith(
			"Food announcement capture failed",
			expect.any(Error),
			{ messageId: "retry", phase: "capture" },
		);
		await client`ALTER TABLE food_announcement_ingestions DROP CONSTRAINT reject_capture`;
		await router.handleUpsert({ type: "notify", messages: [raw("retry")] });
		expect(
			await client`SELECT * FROM food_announcement_ingestions WHERE state = 'queued'`,
		).toHaveLength(1);
		expect(sender.sendMessage).not.toHaveBeenCalled();
	});
});
