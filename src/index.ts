import { execFile } from "node:child_process";
import { promisify } from "node:util";
import OpenAI from "openai";
import { FoodIngestionWorker } from "./adapters/inbound/workers/FoodIngestionWorker";
import { DeepseekFoodAssessmentAdapter } from "./adapters/outbound/mess/extraction/DeepseekFoodAssessmentAdapter";
import { PdfRasterizer } from "./adapters/outbound/mess/extraction/PdfRasterizer";
import { ProcessNextFoodAnnouncement as ProcessFood } from "./core/use-cases/ProcessNextFoodAnnouncement";
import { MealSwapResolver } from "./core/services/MealSwapResolver";
import { createMessPersistence } from "./adapters/outbound/mess/postgres/createMessPersistence";
import { ApplicationLifecycle } from "./runtime/ApplicationLifecycle";
import { createRuntimeOperations } from "./runtime/RuntimeOperations";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { HandleIncomingUserMessage } from "./core/use-cases/HandleIncomingUserMessage";
import { StageIncomingFoodAnnouncement } from "./core/use-cases/StageIncomingFoodAnnouncement";
import { AgentLoop } from "./core/services/AgentLoop";
import { SYSTEM_PROMPT } from "./core/prompts/SystemPrompt";
import { loadConfig } from "./config";
import { DeepseekAdapter } from "./adapters/outbound/llm/DeepseekAdapter";
import { InMemoryToolRegistry } from "./adapters/outbound/tool-registry/InMemoryToolRegistry";
import { PinoLoggerAdapter } from "./adapters/outbound/logger/PinoLoggerAdapter";
import { applicationSchema } from "./adapters/outbound/databaseSchemas";
import { PostgresDialogueTurnRepository } from "./adapters/outbound/dialogue-turn-repository/postgres/PostgresDialogueTurnRepository";
import { PostgresMessRepository } from "./adapters/outbound/mess/postgres/PostgresMessRepository";
import { defaultMessCardPresenter } from "./adapters/outbound/mess/formatting/MessCardRenderer";
import { DisplayMessCardTool } from "./tools/DisplayMessCardTool";
import { QueryMessDetailsTool } from "./tools/QueryMessDetailsTool";
import { runDatabaseMigrations } from "./adapters/outbound/dialogue-turn-repository/postgres/migrator";
import { PostgresAccessControlAdapter } from "./adapters/outbound/access-control/postgres/PostgresAccessControlAdapter";
import { PostgresBaileysSessionManager } from "./adapters/outbound/whatsapp/PostgresBaileysSessionManager";
import { BaileysPairingManager } from "./adapters/outbound/whatsapp/BaileysPairingManager";
import { BaileysConnectionManager } from "./adapters/outbound/whatsapp/BaileysConnectionManager";
import { BaileysMessageSenderAdapter } from "./adapters/outbound/whatsapp/BaileysMessageSenderAdapter";
import { DirectMessageInboundAdapter } from "./adapters/inbound/whatsapp/DirectMessageInboundAdapter";
import { FoodAnnouncementInboundAdapter } from "./adapters/inbound/whatsapp/FoodAnnouncementInboundAdapter";
import { WhatsAppMessageContentExtractor } from "./adapters/inbound/whatsapp/router/WhatsAppMessageContentExtractor";
import { WhatsAppMessageNormalizer } from "./adapters/inbound/whatsapp/router/WhatsAppMessageNormalizer";
import { WhatsAppMessageRouter } from "./adapters/inbound/whatsapp/router/WhatsAppMessageRouter";
import { CatchAllLoggingHandler } from "./adapters/inbound/whatsapp/router/CatchAllLoggingHandler";
import { DialogueTurnContextRetrievalAdapter } from "./adapters/outbound/context-retrieval/DialogueTurnContextRetrievalAdapter";
const config = loadConfig();
const logger = new PinoLoggerAdapter(config.LOG_LEVEL);
const logMod = (module: string) => logger.child({ module });
const registry = new InMemoryToolRegistry(logger);
const sqlClient = postgres(config.DATABASE_URL, {
	max: config.DB_MAX_CONNECTIONS,
	idle_timeout: 20,
	connect_timeout: 10,
});
const db = drizzle(sqlClient, { schema: applicationSchema });
const turns = new PostgresDialogueTurnRepository(db, logger),
	messRepository = new PostgresMessRepository(db, logMod("mess-repository"));
const { food, staging } = createMessPersistence(db, logger);
const assessment = new DeepseekFoodAssessmentAdapter(
	new OpenAI({ apiKey: config.DEEPSEEK_API_KEY, baseURL: config.DEEPSEEK_BASE_URL, maxRetries: 0 }),
	new PdfRasterizer(promisify(execFile)),
	config.DEEPSEEK_MODEL,
	config.FOOD_ASSESSMENT_TIMEOUT_MS,
	300,
	logMod("food-assessment"),
);
const processFood = new ProcessFood(
	food,
	assessment,
	new MealSwapResolver(staging),
	logMod("food-ingestion"),
);
const worker = new FoodIngestionWorker(
	processFood,
	logMod("food-worker"),
	config.FOOD_WORKER_DEADLINE_MS,
);
[
	new DisplayMessCardTool(messRepository, defaultMessCardPresenter),
	new QueryMessDetailsTool(messRepository),
].forEach((tool) => registry.register(tool));
const access = new PostgresAccessControlAdapter(db, logMod("access-control"));
const deepseekAdapter = new DeepseekAdapter(config.DEEPSEEK_API_KEY, {
	baseURL: config.DEEPSEEK_BASE_URL,
	model: config.DEEPSEEK_MODEL,
	logger,
});
const sessions = new PostgresBaileysSessionManager(db, logger, "default"),
	pairing = new BaileysPairingManager(logger),
	connection = new BaileysConnectionManager(logger, pairing, sessions),
	sender = new BaileysMessageSenderAdapter(connection, logger);
const loop = new AgentLoop(deepseekAdapter, registry, {
	maxToolIterations: config.MAX_TOOL_ITERATIONS,
	systemPrompt: SYSTEM_PROMPT,
});
const context = new DialogueTurnContextRetrievalAdapter(turns, logger, {
	maxTurns: config.MAX_HISTORY_TURNS,
	ttlMs: config.HISTORY_TTL_HOURS * 3_600_000,
});
const handleUser = new HandleIncomingUserMessage(sender, turns, context, loop, registry, logger);
const foodLog = logMod("food-announcements"),
	stageFoodAnnouncement = new StageIncomingFoodAnnouncement(food, foodLog),
	dmAdapter = new DirectMessageInboundAdapter(handleUser, access, logMod("direct-message")),
	foodAnnouncementAdapter = new FoodAnnouncementInboundAdapter({
		targetGroupJid: config.FOOD_ANNOUNCEMENTS_GROUP_JID,
		useCase: stageFoodAnnouncement,
		logger: foodLog,
	}),
	content = new WhatsAppMessageContentExtractor(logMod("content-extractor")),
	normalizer = new WhatsAppMessageNormalizer(logMod("normalizer"), content);
const router = new WhatsAppMessageRouter(normalizer, logMod("router"))
	.register(foodAnnouncementAdapter)
	.register(dmAdapter)
	.register(new CatchAllLoggingHandler(logMod("catch-all-handler")));
const seeds = config.ALLOWED_USERS.map((p, i) => ({
	phoneNumber: p,
	name: config.ALLOWED_USER_NAMES[i] || null,
}));
const operations = createRuntimeOperations({
	migrate: () => runDatabaseMigrations(db, logger),
	initFood: () => food.initialize(config.FOOD_ANNOUNCEMENTS_GROUP_JID),
	subscribe: (h) => connection.subscribe("messages.upsert", h),
	handleUpsert: (u) => router.handleUpsert(u as Parameters<typeof router.handleUpsert>[0]),
	initSession: () => sessions.initSession(),
	startConnection: (session) =>
		connection.start({
			session: session as Parameters<typeof connection.start>[0]["session"],
			botPhoneNumber: config.BOT_PHONE_NUMBER,
		}),
	startWorker: () => worker.start(),
	stopWorker: () => worker.stop(),
});
const lifecycle = new ApplicationLifecycle(
	logger,
	() => connection.disconnect(),
	(timeout) => sqlClient.end({ timeout }),
	(code) => process.exit(code),
	access,
	seeds,
	operations,
);
lifecycle.attachSignalHandlers();
lifecycle.start().catch((error) => lifecycle.startupFailure(error));
