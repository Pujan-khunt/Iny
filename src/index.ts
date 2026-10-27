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
import * as dialogueSchema from "./adapters/outbound/dialogue-turn-repository/postgres/schema";
import * as whatsappSchema from "./adapters/outbound/whatsapp/postgres/schema";
import * as accessControlSchema from "./adapters/outbound/access-control/postgres/schema";
import * as messSchema from "./adapters/outbound/mess/postgres/schema";
import { PostgresDialogueTurnRepository } from "./adapters/outbound/dialogue-turn-repository/postgres/PostgresDialogueTurnRepository";
import { PostgresMessRepository } from "./adapters/outbound/mess/postgres/PostgresMessRepository";
import { PostgresMessStagingRepository } from "./adapters/outbound/mess/postgres/PostgresMessStagingRepository";
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
const db = drizzle(sqlClient, {
	schema: { ...dialogueSchema, ...whatsappSchema, ...accessControlSchema, ...messSchema },
});
const dialogueTurnRepository = new PostgresDialogueTurnRepository(db, logger);
const messRepository = new PostgresMessRepository(db, logMod("mess-repository"));
const messStagingRepository = new PostgresMessStagingRepository(db, logMod("mess-staging"));
registry.register(new DisplayMessCardTool(messRepository, defaultMessCardPresenter));
registry.register(new QueryMessDetailsTool(messRepository));
const accessControl = new PostgresAccessControlAdapter(db, logMod("access-control"));
const deepseekAdapter = new DeepseekAdapter(config.DEEPSEEK_API_KEY, {
	baseURL: config.DEEPSEEK_BASE_URL,
	model: config.DEEPSEEK_MODEL,
	logger,
});
const sessionManager = new PostgresBaileysSessionManager(db, logger, "default");
const pairingManager = new BaileysPairingManager(logger);
const connectionManager = new BaileysConnectionManager(logger, pairingManager, sessionManager);
const messageSender = new BaileysMessageSenderAdapter(connectionManager, logger);
const agentLoop = new AgentLoop(deepseekAdapter, registry, {
	maxToolIterations: config.MAX_TOOL_ITERATIONS,
	systemPrompt: SYSTEM_PROMPT,
});
const contextRetrieval = new DialogueTurnContextRetrievalAdapter(dialogueTurnRepository, logger, {
	maxTurns: config.MAX_HISTORY_TURNS,
});
const useCase = new HandleIncomingUserMessage(
	messageSender,
	dialogueTurnRepository,
	contextRetrieval,
	agentLoop,
	registry,
	logger,
);
const stageFoodAnnouncement = new StageIncomingFoodAnnouncement(
	messStagingRepository,
	logMod("food-announcements"),
);
const directMessageAdapter = new DirectMessageInboundAdapter(
	useCase,
	accessControl,
	logMod("direct-message"),
);
const foodAnnouncementAdapter = new FoodAnnouncementInboundAdapter({
	targetGroupJid: config.FOOD_ANNOUNCEMENTS_GROUP_JID,
	useCase: stageFoodAnnouncement,
	logger: logMod("food-announcements"),
});
const contentExtractor = new WhatsAppMessageContentExtractor(logMod("content-extractor"));
const normalizer = new WhatsAppMessageNormalizer(logMod("normalizer"), contentExtractor);
const router = new WhatsAppMessageRouter(normalizer, logMod("router"))
	.register(foodAnnouncementAdapter)
	.register(directMessageAdapter)
	.register(new CatchAllLoggingHandler(logMod("catch-all-handler")));

let isShuttingDown = false;
async function shutdown(signal: string, exitCode = 0) {
	if (isShuttingDown) return;
	isShuttingDown = true;
	logger.info(`Received ${signal}. Closing connections gracefully...`);
	try {
		connectionManager.disconnect();
	} catch (e) {
		logger.error("Error closing WhatsApp connection", e);
	}
	await sqlClient
		.end({ timeout: 5 })
		.catch((e: unknown) => logger.error("Error closing database pool", e));
	process.exit(exitCode);
}

const handleFatal = (name: string) => (err: unknown) => {
	logger.fatal(name, err instanceof Error ? err : new Error(String(err)));
	shutdown(name, 1);
};
process.on("SIGINT", () => shutdown("SIGINT", 0));
process.on("SIGTERM", () => shutdown("SIGTERM", 0));
process.on("uncaughtException", handleFatal("Uncaught exception"));
process.on("unhandledRejection", handleFatal("Unhandled promise rejection"));

async function start() {
	await runDatabaseMigrations(db, logger);
	if (config.ALLOWED_USERS.length > 0) {
		const seeds = config.ALLOWED_USERS.map((phoneNumber, index) => ({
			phoneNumber,
			name: config.ALLOWED_USER_NAMES[index] || null,
		}));
		await accessControl.seedUsers(seeds);
	}
	const count = await accessControl.countActiveUsers();
	if (count === 0) {
		logger.fatal("No active authorized users found. Iny cannot start.");
		await sqlClient.end({ timeout: 5 });
		process.exit(1);
	}
	logger.info("Access control initialized", { activeUsers: count });
	connectionManager.subscribe("messages.upsert", (upsert) => router.handleUpsert(upsert));
	logger.info("Subscribed WhatsApp message router to messages.upsert");
	logger.info("Starting Iny WhatsApp connection...");
	const session = await sessionManager.initSession();
	await connectionManager.start({ session, botPhoneNumber: config.BOT_PHONE_NUMBER });
}

start().catch((err) => {
	logger.fatal("Fatal application startup failure", err);
	sqlClient.end({ timeout: 2 }).finally(() => process.exit(1));
});
