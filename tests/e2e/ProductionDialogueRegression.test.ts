import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { newDb } from "pg-mem";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { AgentLoop } from "../../src/core/services/AgentLoop";
import { HandleIncomingUserMessage } from "../../src/core/use-cases/HandleIncomingUserMessage";
import { MessageFactory } from "../../src/core/entities/Message";
import { DialogueTurnFactory } from "../../src/core/entities/DialogueTurn";
import { MessageSenderPort } from "../../src/core/ports/MessageSenderPort";
import { LoggerPort } from "../../src/core/ports/LoggerPort";
import { DialogueTurnContextRetrievalAdapter } from "../../src/adapters/outbound/context-retrieval/DialogueTurnContextRetrievalAdapter";
import { DeepseekAdapter } from "../../src/adapters/outbound/llm/DeepseekAdapter";
import { InMemoryToolRegistry } from "../../src/adapters/outbound/tool-registry/InMemoryToolRegistry";
import { PostgresDialogueTurnRepository } from "../../src/adapters/outbound/dialogue-turn-repository/postgres/PostgresDialogueTurnRepository";
import { PostgresMessRepository } from "../../src/adapters/outbound/mess/postgres/PostgresMessRepository";
import { defaultMessCardPresenter } from "../../src/adapters/outbound/mess/formatting/MessCardRenderer";
import { DisplayMessCardTool } from "../../src/tools/DisplayMessCardTool";
import { SYSTEM_PROMPT } from "../../src/core/prompts/SystemPrompt";
import { messMeals } from "../../src/adapters/outbound/mess/postgres/schema";
import { dialogueTurns } from "../../src/adapters/outbound/dialogue-turn-repository/postgres/schema";

const { mockCreate } = vi.hoisted(() => ({
	mockCreate: vi.fn(),
}));

vi.mock("openai", () => ({
	default: vi.fn().mockImplementation(function (this: any, config: any) {
		this.apiKey = config.apiKey;
		this.baseURL = config.baseURL;
		this.chat = { completions: { create: mockCreate } };
		return this;
	}),
}));

const mockLogger: LoggerPort = {
	trace: vi.fn(),
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	fatal: vi.fn(),
	child: vi.fn().mockReturnThis(),
} as unknown as LoggerPort;

function initTestDatabase(): NodePgDatabase {
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

	return drizzle(pool);
}

describe("Production Dialogue Quality Regression Replay", () => {
	let db: NodePgDatabase;
	let chatRepo: PostgresDialogueTurnRepository;
	let messRepo: PostgresMessRepository;
	let contextRetrieval: DialogueTurnContextRetrievalAdapter;
	let displayTool: DisplayMessCardTool;
	let registry: InMemoryToolRegistry;
	let deepseekAdapter: DeepseekAdapter;
	let agentLoop: AgentLoop;
	let senderMock: MessageSenderPort;
	let useCase: HandleIncomingUserMessage;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.spyOn(Date, "now").mockReturnValue(new Date("2026-10-31T07:03:00.000Z").getTime());
		db = initTestDatabase();
		chatRepo = new PostgresDialogueTurnRepository(db, mockLogger);
		messRepo = new PostgresMessRepository(db, mockLogger);
		contextRetrieval = new DialogueTurnContextRetrievalAdapter(chatRepo, mockLogger, {
			maxTurns: 10,
			ttlMs: 24 * 60 * 60 * 1000,
		});
		displayTool = new DisplayMessCardTool(messRepo, defaultMessCardPresenter);
		registry = new InMemoryToolRegistry(mockLogger);
		registry.register(displayTool);
		deepseekAdapter = new DeepseekAdapter("mock-key", { logger: mockLogger });
		agentLoop = new AgentLoop(deepseekAdapter, registry, {
			systemPrompt: SYSTEM_PROMPT,
			maxToolIterations: 5,
		});
		senderMock = {
			sendMessage: vi.fn().mockResolvedValue({ id: "msg-out-1" }),
		};
		useCase = new HandleIncomingUserMessage(
			senderMock,
			chatRepo,
			contextRetrieval,
			agentLoop,
			registry,
			mockLogger,
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("T45 - Stale Context Guard", () => {
		it("replays T45: stale Friday context produces IST timestamp prefix and triggers Saturday menu fetch", async () => {
			await db.insert(messMeals).values([
				{
					id: "a1111111-1111-1111-1111-111111111111",
					mealDate: "2026-10-30",
					mealSlot: "lunch",
					vendor: "cheftalk_regular",
					items: ["Aloo Gobi", "Dal Tadka", "Roti", "Rice"],
					ingestedAt: new Date("2026-10-30T06:00:00Z"),
				},
				{
					id: "b2222222-2222-2222-2222-222222222222",
					mealDate: "2026-10-31",
					mealSlot: "lunch",
					vendor: "cheftalk_regular",
					items: ["Paneer Butter Masala", "Dal Makhani", "Naan", "Jeera Rice"],
					ingestedAt: new Date("2026-10-31T06:00:00Z"),
				},
			]);

			const fridayTurn = DialogueTurnFactory.create({
				userId: "user-t45",
				messages: [
					MessageFactory.createUser({
						userId: "user-t45",
						content: "What is for lunch?",
						timestamp: new Date("2026-10-30T07:19:00.000Z"),
					}),
					MessageFactory.createAssistantText({
						userId: "user-t45",
						content: "🍽️ Lunch Menu: Aloo Gobi, Dal Tadka, Roti, Rice",
					}),
				],
				startedAt: new Date("2026-10-30T07:18:55.000Z"),
				completedAt: new Date("2026-10-30T07:19:00.000Z"),
			});
			await chatRepo.saveTurn(fridayTurn);

			const incomingMsg = MessageFactory.createUser({
				userId: "user-t45",
				content: "Today's lunch",
				timestamp: new Date("2026-10-31T07:03:00.000Z"),
			});

			mockCreate.mockImplementation(async (request: any) => {
				const msgs = request.messages;
				const histUser = msgs.find(
					(m: any) => m.role === "user" && m.content.includes("What is for lunch?"),
				);
				expect(histUser?.content).toBe("[Sent: 2026-10-30 12:49 IST] What is for lunch?");

				const activeUser = msgs[msgs.length - 1];
				expect(activeUser.content).toBe("Today's lunch");

				return {
					choices: [
						{
							finish_reason: "tool_calls",
							message: {
								tool_calls: [
									{
										id: "call_disp_sat",
										type: "function",
										function: {
											name: "display_mess_card",
											arguments: JSON.stringify({
												mealSlot: "lunch",
												mealDate: "2026-10-31",
											}),
										},
									},
								],
							},
						},
					],
				};
			});

			await useCase.execute(incomingMsg);

			expect(mockCreate).toHaveBeenCalledTimes(1);
			expect(senderMock.sendMessage).toHaveBeenCalledTimes(1);
			const sentText = (senderMock.sendMessage as any).mock.calls[0][1];
			expect(sentText).toContain("Paneer Butter Masala");
			expect(sentText).toContain("Dal Makhani");
			expect(sentText).not.toContain("Aloo Gobi");

			const turns = await db
				.select()
				.from(dialogueTurns)
				.where(eq(dialogueTurns.userId, "user-t45"));
			expect(turns).toHaveLength(2);
		});
	});

	describe("T50 - Deterministic Missing Menu Notice", () => {
		it("replays T50: returns deterministic missing menu notice without cancellation hallucinations", async () => {
			const result = await displayTool.execute({
				mealDate: "2026-11-01",
				mealSlot: "breakfast",
				vendor: "cheftalk_regular",
			});

			expect(result.isTerminal).toBe(true);
			expect(result.content).toBe(
				"ℹ️ No menu data is currently loaded for Cheftalk breakfast on 2026-11-01.",
			);
			expect(result.content.toLowerCase()).not.toContain("not serving");
			expect(result.content.toLowerCase()).not.toContain("cancelled");
			expect(result.content.toLowerCase()).not.toContain("holiday");
			expect(result.content.toLowerCase()).not.toContain("closed");
		});

		it("replays T50: delivers missing menu notice via early termination with zero follow-up hallucination", async () => {
			const userMsg = MessageFactory.createUser({
				userId: "user-t50",
				content: "Breakfast menu for tomorrow",
				timestamp: new Date("2026-10-31T07:03:00.000Z"),
			});

			mockCreate.mockResolvedValueOnce({
				choices: [
					{
						finish_reason: "tool_calls",
						message: {
							tool_calls: [
								{
									id: "call_t50_missing",
									type: "function",
									function: {
										name: "display_mess_card",
										arguments: JSON.stringify({
											mealDate: "2026-11-01",
											mealSlot: "breakfast",
											vendor: "cheftalk_regular",
										}),
									},
								},
							],
						},
					},
				],
			});

			await useCase.execute(userMsg);

			expect(mockCreate).toHaveBeenCalledTimes(1);
			expect(senderMock.sendMessage).toHaveBeenCalledTimes(1);
			const sentText = (senderMock.sendMessage as any).mock.calls[0][1];
			expect(sentText).toBe(
				"ℹ️ No menu data is currently loaded for Cheftalk breakfast on 2026-11-01.",
			);
			expect(sentText.toLowerCase()).not.toContain("not serving");
			expect(sentText.toLowerCase()).not.toContain("cancelled");
		});
	});

	describe("T15 / T16 - Vendor Preference Retention and Dialogue Persistence", () => {
		it("replays T15 / T16: retains user vendor preference across turns while pruning raw tool bloat", async () => {
			const priorTurnTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
			const priorTurn = DialogueTurnFactory.create({
				userId: "user-t15",
				messages: [
					MessageFactory.createUser({
						userId: "user-t15",
						content: "I am subscribed to cheftalk this month",
						timestamp: priorTurnTime,
					}),
					MessageFactory.createAssistantToolCall({
						userId: "user-t15",
						toolCalls: [
							{
								id: "call_pref_1",
								name: "query_mess_details",
								type: "valid",
								arguments: { query: "cheftalk" },
							},
						],
					}),
					MessageFactory.createToolResult({
						userId: "user-t15",
						toolCallId: "call_pref_1",
						name: "query_mess_details",
						content: JSON.stringify({ rawDebugData: "extensive database json dump", items: [] }),
					}),
					MessageFactory.createAssistantText({
						userId: "user-t15",
						content: "Got it! I will remember you are subscribed to Cheftalk.",
					}),
				],
				startedAt: new Date(priorTurnTime.getTime() - 5000),
				completedAt: priorTurnTime,
			});
			await chatRepo.saveTurn(priorTurn);

			const retrievedContext = await contextRetrieval.retrieveContext("user-t15");
			expect(retrievedContext).toHaveLength(2);
			expect(retrievedContext[0].content).toBe("I am subscribed to cheftalk this month");
			expect(retrievedContext[1].content).toBe(
				"Got it! I will remember you are subscribed to Cheftalk.",
			);
			expect(retrievedContext.some((m) => m.role === "tool")).toBe(false);
			expect(
				retrievedContext.some((m) => m.role === "assistant" && m.toolCalls !== undefined),
			).toBe(false);

			await db.insert(messMeals).values({
				id: "c3333333-3333-3333-3333-333333333333",
				mealDate: "2026-10-31",
				mealSlot: "lunch",
				vendor: "cheftalk_regular",
				items: ["Dum Aloo", "Jeera Rice", "Chapati", "Curd"],
				ingestedAt: new Date(),
			});

			const activeMsg = MessageFactory.createUser({
				userId: "user-t15",
				content: "menu",
				timestamp: new Date("2026-10-31T07:03:00.000Z"),
			});

			mockCreate.mockImplementation(async (request: any) => {
				const msgs = request.messages;
				const prefMsg = msgs.find(
					(m: any) =>
						m.role === "user" && m.content.includes("I am subscribed to cheftalk this month"),
				);
				expect(prefMsg).toBeDefined();
				expect(prefMsg.content).toMatch(
					/^\[Sent: \d{4}-\d{2}-\d{2} \d{2}:\d{2} IST\] I am subscribed to cheftalk this month$/,
				);

				expect(
					msgs.some(
						(m: any) => m.content === "Got it! I will remember you are subscribed to Cheftalk.",
					),
				).toBe(true);

				expect(msgs.some((m: any) => m.role === "tool")).toBe(false);
				expect(msgs.some((m: any) => m.role === "assistant" && m.tool_calls)).toBe(false);

				expect(msgs[msgs.length - 1].content).toBe("menu");

				return {
					choices: [
						{
							finish_reason: "tool_calls",
							message: {
								tool_calls: [
									{
										id: "call_disp_cheftalk",
										type: "function",
										function: {
											name: "display_mess_card",
											arguments: JSON.stringify({
												mealSlot: "lunch",
												mealDate: "2026-10-31",
												vendor: "cheftalk_regular",
											}),
										},
									},
								],
							},
						},
					],
				};
			});

			await useCase.execute(activeMsg);

			expect(mockCreate).toHaveBeenCalledTimes(1);
			expect(senderMock.sendMessage).toHaveBeenCalledTimes(1);
			const sentText = (senderMock.sendMessage as any).mock.calls[0][1];
			expect(sentText).toContain("Cheftalk");
			expect(sentText).toContain("Dum Aloo");
		});
	});
});
