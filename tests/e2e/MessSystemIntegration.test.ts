import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { newDb } from "pg-mem";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { AgentLoop } from "../../src/core/services/AgentLoop";
import { HandleIncomingUserMessage } from "../../src/core/use-cases/HandleIncomingUserMessage";
import { MessageFactory, UserMessage } from "../../src/core/entities/Message";
import { LLMPort, LLMResponse } from "../../src/core/ports/LLMPort";
import { MessageSenderPort } from "../../src/core/ports/MessageSenderPort";
import { ContextRetrievalPort } from "../../src/core/ports/ContextRetrievalPort";
import { LoggerPort } from "../../src/core/ports/LoggerPort";
import { InMemoryToolRegistry } from "../../src/adapters/outbound/tool-registry/InMemoryToolRegistry";
import { PostgresDialogueTurnRepository } from "../../src/adapters/outbound/dialogue-turn-repository/postgres/PostgresDialogueTurnRepository";
import { PostgresMessRepository } from "../../src/adapters/outbound/mess/postgres/PostgresMessRepository";
import { PostgresMessStagingRepository } from "../../src/adapters/outbound/mess/postgres/PostgresMessStagingRepository";
import { defaultMessCardPresenter } from "../../src/adapters/outbound/mess/formatting/MessCardRenderer";
import { DisplayMessCardTool } from "../../src/tools/DisplayMessCardTool";
import { QueryMessDetailsTool } from "../../src/tools/QueryMessDetailsTool";
import { FoodAnnouncementInboundAdapter } from "../../src/adapters/inbound/whatsapp/FoodAnnouncementInboundAdapter";
import { StageIncomingFoodAnnouncement } from "../../src/core/use-cases/StageIncomingFoodAnnouncement";
import { WhatsAppMessageNormalizer } from "../../src/adapters/inbound/whatsapp/router/WhatsAppMessageNormalizer";
import { WhatsAppMessageContentExtractor } from "../../src/adapters/inbound/whatsapp/router/WhatsAppMessageContentExtractor";
import { WhatsAppMessageRouter } from "../../src/adapters/inbound/whatsapp/router/WhatsAppMessageRouter";
import { DeepseekTextExtractor } from "../../src/adapters/outbound/mess/extraction/DeepseekTextExtractor";
import {
	messMeals,
	messMealLocationDetails,
	whatsappGroupFoodAnnouncementsMessages,
} from "../../src/adapters/outbound/mess/postgres/schema";
import { dialogueTurns } from "../../src/adapters/outbound/dialogue-turn-repository/postgres/schema";
import { WAMessage } from "@whiskeysockets/baileys";

describe("Mess System End-to-End Integration", () => {
	const TEST_DATE = "2026-10-09";
	const FOOD_GROUP_JID = "120363025343425345@g.us";

	const mockLogger: LoggerPort = {
		trace: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis(),
	} as unknown as LoggerPort;

	describe("Composition Root Wiring (src/index.ts)", () => {
		it("verifies that src/index.ts wires repositories, tools, router, and inbound adapters", () => {
			const indexPath = path.resolve(__dirname, "../../src/index.ts");
			const indexContent = fs.readFileSync(indexPath, "utf-8");

			// Verify imports
			expect(indexContent).toContain("PostgresMessRepository");
			expect(indexContent).toContain("PostgresMessStagingRepository");
			expect(indexContent).toContain("PostgresDialogueTurnRepository");
			expect(indexContent).toContain("DialogueTurnContextRetrievalAdapter");
			expect(indexContent).toContain("HandleIncomingUserMessage");
			expect(indexContent).toContain("StageIncomingFoodAnnouncement");
			expect(indexContent).toContain("DisplayMessCardTool");
			expect(indexContent).toContain("QueryMessDetailsTool");
			expect(indexContent).toContain("FoodAnnouncementInboundAdapter");
			expect(indexContent).toContain("DirectMessageInboundAdapter");
			expect(indexContent).toContain("WhatsAppMessageNormalizer");
			expect(indexContent).toContain("WhatsAppMessageRouter");
			expect(indexContent).toContain("CatchAllLoggingHandler");
			expect(indexContent).toContain("messSchema");
			expect(indexContent).toContain("dialogueSchema");

			// Verify instantiation & wiring
			expect(indexContent).toMatch(/new\s+PostgresMessRepository\s*\(/);
			expect(indexContent).toMatch(/new\s+PostgresMessStagingRepository\s*\(/);
			expect(indexContent).toMatch(/new\s+PostgresDialogueTurnRepository\s*\(/);
			expect(indexContent).toMatch(/new\s+DialogueTurnContextRetrievalAdapter\s*\(/);
			expect(indexContent).toMatch(/new\s+HandleIncomingUserMessage\s*\(/);
			expect(indexContent).toMatch(/new\s+StageIncomingFoodAnnouncement\s*\(/);
			expect(indexContent).toMatch(/new\s+DisplayMessCardTool\s*\(/);
			expect(indexContent).toMatch(/new\s+QueryMessDetailsTool\s*\(/);
			expect(indexContent).toMatch(/registry\.register\s*\(\s*new\s+DisplayMessCardTool\s*\(/);
			expect(indexContent).toMatch(/registry\.register\s*\(\s*new\s+QueryMessDetailsTool\s*\(/);

			// Verify router and inbound adapters wiring and startup
			expect(indexContent).toMatch(/new\s+FoodAnnouncementInboundAdapter\s*\(/);
			expect(indexContent).toMatch(/new\s+DirectMessageInboundAdapter\s*\(/);
			expect(indexContent).toMatch(/new\s+WhatsAppMessageNormalizer\s*\(/);
			expect(indexContent).toMatch(/new\s+WhatsAppMessageRouter\s*\(/);
			expect(indexContent).toMatch(/(?:router)?\.register\s*\(\s*foodAnnouncementAdapter\s*\)/);
			expect(indexContent).toMatch(/\.register\s*\(\s*directMessageAdapter\s*\)/);
			expect(indexContent).toMatch(/\.register\s*\(\s*new\s+CatchAllLoggingHandler\s*\(/);
			expect(indexContent).toMatch(/FOOD_ANNOUNCEMENTS_GROUP_JID/);
			expect(indexContent).toMatch(
				/connectionManager\.subscribe\s*\(\s*["']messages\.upsert["'],\s*\(?upsert\)?\s*=>/,
			);
			expect(indexContent).toMatch(/router\.handleUpsert\s*\(\s*upsert\s*\)/);
		});
	});

	describe("Runtime Flow & Database Invariants", () => {
		let db: NodePgDatabase;
		let chatRepository: PostgresDialogueTurnRepository;
		let messRepository: PostgresMessRepository;
		let stagingRepository: PostgresMessStagingRepository;
		let registry: InMemoryToolRegistry;
		let senderMock: MessageSenderPort;
		let contextRetrievalMock: ContextRetrievalPort;

		beforeEach(async () => {
			vi.clearAllMocks();

			const memDb = newDb();
			memDb.public.registerFunction({
				name: "jsonb_array_length",
				args: [(memDb.public as any).getType("jsonb")],
				returns: (memDb.public as any).getType("integer"),
				implementation: (arr: any) =>
					Array.isArray(arr) ? arr.length : typeof arr === "string" ? JSON.parse(arr).length : 0,
			});

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

        CREATE TABLE dialogue_turns (
          id UUID PRIMARY KEY,
          user_id VARCHAR(128) NOT NULL,
          user_query TEXT NOT NULL,
          assistant_response TEXT NOT NULL,
          tool_names TEXT[] NOT NULL DEFAULT '{}',
          reasoning TEXT[] NOT NULL DEFAULT '{}',
          started_at TIMESTAMPTZ NOT NULL,
          completed_at TIMESTAMPTZ NOT NULL,
          duration_ms INTEGER,
          messages JSONB NOT NULL,
          CONSTRAINT chk_dialogue_turns_messages CHECK (
            jsonb_array_length(messages) >= 2 AND 
            (messages->0->>'role') = 'user' AND 
            (messages->-1->>'role') = 'assistant' AND 
            (messages->-1->'toolCalls') IS NULL
          )
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
			chatRepository = new PostgresDialogueTurnRepository(db, mockLogger);
			messRepository = new PostgresMessRepository(db, mockLogger);
			stagingRepository = new PostgresMessStagingRepository(db, mockLogger);

			// Seed lunch meals and seating allocation for testing
			await db.insert(messMeals).values([
				{
					id: "11111111-1111-1111-1111-111111111111",
					mealDate: TEST_DATE,
					mealSlot: "lunch",
					vendor: "cheftalk_regular",
					items: ["Rajma Masala", "Jeera Rice", "Roti", "Boondi Raita"],
					ingestedAt: new Date(),
				},
				{
					id: "22222222-2222-2222-2222-222222222222",
					mealDate: TEST_DATE,
					mealSlot: "lunch",
					vendor: "cheftalk_jain",
					items: ["Yellow Dal", "Jeera Rice", "Roti", "Cucumber Raita"],
					ingestedAt: new Date(),
				},
				{
					id: "33333333-3333-3333-3333-333333333333",
					mealDate: TEST_DATE,
					mealSlot: "lunch",
					vendor: "tcb",
					items: ["Chole Bhature", "Veg Pulao", "Gulab Jamun"],
					ingestedAt: new Date(),
				},
			]);

			await db.insert(messMealLocationDetails).values({
				id: "44444444-4444-4444-4444-444444444444",
				mealDate: TEST_DATE,
				mealSlot: "lunch",
				hostelBatches: ["2027", "2028"],
				collegeBatches: ["2025", "2026"],
				ingestedAt: new Date(),
			});

			// Register tools
			registry = new InMemoryToolRegistry(mockLogger);
			const fixedTime = new Date("2026-10-09T07:00:00Z"); // 12:30 PM IST
			const displayTool = new DisplayMessCardTool(
				messRepository,
				defaultMessCardPresenter,
				() => fixedTime,
			);
			const queryTool = new QueryMessDetailsTool(messRepository, () => fixedTime);
			registry.register(displayTool);
			registry.register(queryTool);

			senderMock = {
				sendMessage: vi.fn().mockResolvedValue({ id: "msg-out-1" }),
			};

			contextRetrievalMock = {
				retrieveContext: vi.fn().mockResolvedValue([]),
			};
		});

		it("executes DisplayMessCardTool in AgentLoop and HandleIncomingUserMessage with early termination and check constraint satisfaction", async () => {
			// LLM emits a tool call for display_mess_card
			const llmMock: LLMPort = {
				generateResponse: vi.fn().mockResolvedValue({
					type: "tool_calls",
					toolCalls: [
						{
							type: "valid",
							id: "call_display_lunch",
							name: "display_mess_card",
							arguments: {
								mealSlot: "lunch",
								mealDate: TEST_DATE,
							},
						},
					],
				} satisfies LLMResponse),
			};

			const agentLoop = new AgentLoop(llmMock, registry, {
				systemPrompt: "You are a helpful assistant.",
			});

			const useCase = new HandleIncomingUserMessage(
				senderMock,
				chatRepository,
				contextRetrievalMock,
				agentLoop,
				registry,
				mockLogger,
			);

			const incomingUserMessage: UserMessage = MessageFactory.createUser({
				userId: "919876543210@s.whatsapp.net",
				content: "What's for lunch?",
				timestamp: new Date("2026-10-09T07:00:00Z"),
			});

			await useCase.execute(incomingUserMessage);

			// 1. LLM early termination verification: exactly 1 call (short-circuited without turn 2)
			expect(llmMock.generateResponse).toHaveBeenCalledTimes(1);

			// 2. Transport delivery verification: card was sent to user
			expect(senderMock.sendMessage).toHaveBeenCalledTimes(1);
			const sentMessageText = (senderMock.sendMessage as any).mock.calls[0][1];
			expect(sentMessageText).toContain("🍽️ *Lunch Menu*");
			expect(sentMessageText).toContain(
				"🍛 *Cheftalk Regular:* Rajma Masala, Jeera Rice, Roti, Boondi Raita",
			);
			expect(sentMessageText).toContain(
				"🥗 *Cheftalk Jain:* Yellow Dal, Jeera Rice, Roti, Cucumber Raita",
			);
			expect(sentMessageText).toContain(
				"☕ *TCB (Uniworld):* Chole Bhature, Veg Pulao, Gulab Jamun",
			);
			expect(sentMessageText).toContain("📍 *Location:*");
			expect(sentMessageText).toContain("• *Hostel:* Batches 2027, 2028");
			expect(sentMessageText).toContain("• *College:* Batches 2025, 2026");

			// 3. Database persistence & check constraint verification
			const turns = await db.select().from(dialogueTurns);
			expect(turns).toHaveLength(1);

			const turn = turns[0];
			expect(turn.userId).toBe("919876543210@s.whatsapp.net");
			expect(turn.userQuery).toBe("What's for lunch?");
			expect(turn.assistantResponse).toBe(sentMessageText);
			expect(turn.toolNames).toEqual(["display_mess_card"]);

			// Structure of messages array:
			// [UserMessage, AssistantToolCallMessage, ToolResultMessage, AssistantTextMessage]
			const messages = turn.messages as any[];
			expect(messages).toHaveLength(4);

			expect(messages[0].role).toBe("user");
			expect(messages[0].content).toBe("What's for lunch?");

			expect(messages[1].role).toBe("assistant");
			expect(messages[1].toolCalls).toBeDefined();
			expect(messages[1].toolCalls[0].name).toBe("display_mess_card");

			expect(messages[2].role).toBe("tool");
			expect(messages[2].content).toBe(sentMessageText);

			expect(messages[3].role).toBe("assistant");
			expect(messages[3].content).toBe(sentMessageText);
			expect(messages[3].toolCalls).toBeUndefined(); // Satisfies chk_dialogue_turns_messages
		});

		it("executes QueryMessDetailsTool in conversational 2-turn flow without early termination", async () => {
			// Turn 1: LLM returns tool_call for query_mess_details (non-terminal)
			// Turn 2: LLM receives tool result and returns synthesized text
			const llmMock: LLMPort = {
				generateResponse: vi
					.fn()
					.mockResolvedValueOnce({
						type: "tool_calls",
						toolCalls: [
							{
								type: "valid",
								id: "call_query_lunch",
								name: "query_mess_details",
								arguments: {
									mealSlot: "lunch",
									mealDate: TEST_DATE,
									vendor: "cheftalk_regular",
								},
							},
						],
					} satisfies LLMResponse)
					.mockResolvedValueOnce({
						type: "text",
						content:
							"Cheftalk Regular is serving Rajma Masala, Jeera Rice, Roti, and Boondi Raita for lunch.",
					} satisfies LLMResponse),
			};

			const agentLoop = new AgentLoop(llmMock, registry, {
				systemPrompt: "You are a helpful assistant.",
			});

			const useCase = new HandleIncomingUserMessage(
				senderMock,
				chatRepository,
				contextRetrievalMock,
				agentLoop,
				registry,
				mockLogger,
			);

			const incomingUserMessage: UserMessage = MessageFactory.createUser({
				userId: "919876543210@s.whatsapp.net",
				content: "What is Cheftalk serving for lunch?",
			});

			await useCase.execute(incomingUserMessage);

			// Verifies non-terminal: 2 iterations required
			expect(llmMock.generateResponse).toHaveBeenCalledTimes(2);

			expect(senderMock.sendMessage).toHaveBeenCalledWith(
				"919876543210@s.whatsapp.net",
				"Cheftalk Regular is serving Rajma Masala, Jeera Rice, Roti, and Boondi Raita for lunch.",
			);

			// Check database turn persistence
			const turns = await db.select().from(dialogueTurns);
			expect(turns).toHaveLength(1);
			expect(turns[0].toolNames).toEqual(["query_mess_details"]);
			expect(turns[0].assistantResponse).toBe(
				"Cheftalk Regular is serving Rajma Masala, Jeera Rice, Roti, and Boondi Raita for lunch.",
			);
		});

		it("stages inbound food announcement messages into PostgreSQL database via FoodAnnouncementInboundAdapter", async () => {
			let registeredHandler: ((upsert: any) => Promise<void>) | null = null;
			const fakeConnectionManager = {
				subscribe: vi.fn().mockImplementation((event: string, handler: any) => {
					if (event === "messages.upsert") {
						registeredHandler = handler;
					}
				}),
			};

			const fakeDownloadMedia = vi
				.fn()
				.mockResolvedValue(Buffer.from("test-weekly-menu-pdf-bytes"));

			const useCase = new StageIncomingFoodAnnouncement(stagingRepository, mockLogger);
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid: FOOD_GROUP_JID,
				useCase,
				logger: mockLogger,
			});
			const contentExtractor = new WhatsAppMessageContentExtractor(
				mockLogger,
				fakeDownloadMedia as any,
			);
			const normalizer = new WhatsAppMessageNormalizer(mockLogger, contentExtractor);
			const router = new WhatsAppMessageRouter(normalizer, mockLogger);
			router.register(adapter);
			fakeConnectionManager.subscribe("messages.upsert", (upsert: any) =>
				router.handleUpsert(upsert),
			);

			expect(fakeConnectionManager.subscribe).toHaveBeenCalledWith(
				"messages.upsert",
				expect.any(Function),
			);
			expect(registeredHandler).not.toBeNull();

			// Simulate incoming WhatsApp announcement document message
			const incomingWAMessage: WAMessage = {
				key: {
					remoteJid: FOOD_GROUP_JID,
					fromMe: false,
					id: "WA_STAGED_MSG_999",
					participant: "919876543210@s.whatsapp.net",
				},
				message: {
					documentMessage: {
						url: "https://wa.mock/doc",
						mimetype: "application/pdf",
						fileName: "WEEKLY_MENU_OCT_4_10.pdf",
						caption: "Here is the weekly mess menu",
					},
				},
			} as unknown as WAMessage;

			await registeredHandler!({ type: "notify", messages: [incomingWAMessage] });

			// Verify record is staged in database table
			const staged = await db
				.select()
				.from(whatsappGroupFoodAnnouncementsMessages)
				.where(eq(whatsappGroupFoodAnnouncementsMessages.id, "WA_STAGED_MSG_999"));

			expect(staged).toHaveLength(1);
			expect(staged[0].id).toBe("WA_STAGED_MSG_999");
			expect(staged[0].senderAddress).toBe("919876543210@s.whatsapp.net");
			expect(staged[0].senderAddressType).toBe("pn");
			expect(staged[0].messageType).toBe("document");
			expect(staged[0].mediaMimeType).toBe("application/pdf");
			expect(staged[0].textBody).toBe("Here is the weekly mess menu");
			expect(staged[0].status).toBe("pending");
			expect(staged[0].mediaBuffer).toEqual(Buffer.from("test-weekly-menu-pdf-bytes"));

			// Verify that PostgresMessStagingRepository can query the staged message
			const stagedList = await stagingRepository.listStagedMessages({ status: "pending" });
			expect(stagedList.some((m) => m.id === "WA_STAGED_MSG_999")).toBe(true);

			const fetchedById = await stagingRepository.getMessageById("WA_STAGED_MSG_999");
			expect(fetchedById?.id).toBe("WA_STAGED_MSG_999");
			expect(fetchedById?.status).toBe("pending");
		});

		it("processes complete composite food announcement lifecycle (ingestion -> extraction -> atomicCommit -> display -> atomicUndo)", async () => {
			// 1. Inbound adapter with mock connection manager
			let registeredHandler: ((upsert: any) => Promise<void>) | null = null;
			const fakeConnectionManager = {
				subscribe: vi.fn().mockImplementation((event: string, handler: any) => {
					if (event === "messages.upsert") {
						registeredHandler = handler;
					}
				}),
			};

			const useCase = new StageIncomingFoodAnnouncement(stagingRepository, mockLogger);
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid: FOOD_GROUP_JID,
				useCase,
				logger: mockLogger,
			});
			const contentExtractor = new WhatsAppMessageContentExtractor(mockLogger);
			const normalizer = new WhatsAppMessageNormalizer(mockLogger, contentExtractor);
			const router = new WhatsAppMessageRouter(normalizer, mockLogger);
			router.register(adapter);
			fakeConnectionManager.subscribe("messages.upsert", (upsert: any) =>
				router.handleUpsert(upsert),
			);
			expect(registeredHandler).not.toBeNull();

			// 2. Inbound WhatsApp announcement containing combo message (location seating + timing extension)
			const messageId = "WA_COMPOSITE_MSG_E2E_001";
			const announcementText =
				"Lunch timings are extended till 3:30 PM today. Batches 2028 and 2029 will have lunch in Hostel Mess, all other batches in College Mess.";

			const incomingWAMessage: WAMessage = {
				key: {
					remoteJid: FOOD_GROUP_JID,
					fromMe: false,
					id: messageId,
					participant: "919876543210@s.whatsapp.net",
				},
				message: {
					conversation: announcementText,
				},
			} as unknown as WAMessage;

			await registeredHandler!({ type: "notify", messages: [incomingWAMessage] });

			// Verify staged in whatsappGroupFoodAnnouncementsMessages
			const staged = await stagingRepository.getMessageById(messageId);
			expect(staged).not.toBeNull();
			expect(staged?.id).toBe(messageId);
			expect(staged?.status).toBe("pending");
			expect(staged?.textBody).toBe(announcementText);

			// 3. Extracted via DeepseekTextExtractor.extractAnnouncementEvents
			const mockOpenAI = {
				chat: {
					completions: {
						create: vi.fn().mockResolvedValue({
							choices: [
								{
									message: {
										content: JSON.stringify({
											mealDate: TEST_DATE,
											location: {
												mealDate: TEST_DATE,
												mealSlot: "lunch",
												hostelBatches: ["2028", "2029"],
												collegeBatches: ["ALL_OTHER_BATCHES"],
											},
											timingExtensions: [
												{
													mealDate: TEST_DATE,
													mealSlot: "lunch",
													targetVendor: null,
													extendedTimings: "Extended till 15:30",
												},
											],
											mealChanges: [],
											mealSwaps: [],
										}),
									},
								},
							],
						}),
					},
				},
			};

			const extractor = new DeepseekTextExtractor(mockOpenAI as any);
			const extractedEvents = await extractor.extractAnnouncementEvents(
				staged!.textBody!,
				staged!.receivedAt,
			);

			expect(extractedEvents.mealDate).toBe(TEST_DATE);
			expect(extractedEvents.location?.hostelBatches).toEqual(["2028", "2029"]);
			expect(extractedEvents.location?.collegeBatches).toEqual(["ALL_OTHER_BATCHES"]);
			expect(extractedEvents.timingExtensions).toHaveLength(1);
			expect(extractedEvents.timingExtensions[0].extendedTimings).toBe("Extended till 15:30");

			// 4. Committed via PostgresMessStagingRepository.atomicCommitComposite
			await stagingRepository.atomicCommitComposite({
				messageId,
				composite: extractedEvents,
			});

			const processedMsg = await stagingRepository.getMessageById(messageId);
			expect(processedMsg?.status).toBe("processed");
			expect(processedMsg?.processedAt).toBeInstanceOf(Date);

			// 5. Query getResolvedMeal from PostgresMessRepository and verify in DisplayMessCardTool
			const resolved = await messRepository.getResolvedMeal({
				mealDate: TEST_DATE,
				mealSlot: "lunch",
			});
			expect(resolved.locationDetail).not.toBeNull();
			expect(resolved.locationDetail?.hostelBatches).toEqual(["2028", "2029"]);
			expect(resolved.locationDetail?.collegeBatches).toEqual(["ALL_OTHER_BATCHES"]);
			expect(resolved.locationDetail?.sourceMessageId).toBe(messageId);
			expect(resolved.timingExtensions).toHaveLength(1);
			expect(resolved.timingExtensions[0].extendedTimings).toBe("Extended till 15:30");
			expect(resolved.timingExtensions[0].sourceMessageId).toBe(messageId);

			const fixedTime = new Date(`${TEST_DATE}T07:00:00Z`); // 12:30 PM IST on TEST_DATE
			const displayTool = new DisplayMessCardTool(
				messRepository,
				defaultMessCardPresenter,
				() => fixedTime,
			);
			const cardResult = await displayTool.execute({
				mealDate: TEST_DATE,
				mealSlot: "lunch",
			});

			expect(cardResult.isTerminal).toBe(true);
			expect(cardResult.content).toContain("🍽️ *Lunch Menu*");
			expect(cardResult.content).toContain("⏰ *Timings:* Extended till 15:30");
			expect(cardResult.content).toContain("📍 *Location:*");
			expect(cardResult.content).toContain("• *Hostel:* Batches 2028, 2029");
			expect(cardResult.content).toContain("• *College:* All other batches");

			// 6. Execute atomicUndo and verify clean rollback
			await stagingRepository.atomicUndo(messageId);

			const revertedMsg = await stagingRepository.getMessageById(messageId);
			expect(revertedMsg?.status).toBe("pending");
			expect(revertedMsg?.processedAt).toBeNull();

			const postUndoResolved = await messRepository.getResolvedMeal({
				mealDate: TEST_DATE,
				mealSlot: "lunch",
			});
			expect(postUndoResolved.locationDetail).toBeNull();
			expect(postUndoResolved.timingExtensions).toHaveLength(0);

			const postUndoCard = await displayTool.execute({
				mealDate: TEST_DATE,
				mealSlot: "lunch",
			});
			expect(postUndoCard.content).toContain("🍽️ *Lunch Menu*");
			expect(postUndoCard.content).not.toContain("⏰ *Timings:*");
			expect(postUndoCard.content).not.toContain("📍 *Location:*");
		});
	});
});
