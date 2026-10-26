import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { ProcessIncomingMessage } from "./core/use-cases/ProcessIncomingMessage";
import { AgentLoop } from "./core/use-cases/AgentLoop";
import { SYSTEM_PROMPT } from "./core/prompts/SystemPrompt";
import { loadConfig } from "./config";
import { DeepseekAdapter } from "./adapters/outbound/llm/DeepseekAdapter";
import { InMemoryToolRegistry } from "./adapters/outbound/tool-registry/InMemoryToolRegistry";
import { PinoLoggerAdapter } from "./adapters/outbound/logger/PinoLoggerAdapter";
import * as chatSchema from "./adapters/outbound/chat-repository/postgres/schema";
import * as whatsappSchema from "./adapters/outbound/whatsapp/postgres/schema";
import * as accessControlSchema from "./adapters/outbound/access-control/postgres/schema";
import * as messSchema from "./adapters/outbound/mess/postgres/schema";
import { PostgresChatRepository } from "./adapters/outbound/chat-repository/postgres/PostgresChatRepository";
import { PostgresMessRepository } from "./adapters/outbound/mess/postgres/PostgresMessRepository";
import { PostgresMessStagingRepository } from "./adapters/outbound/mess/postgres/PostgresMessStagingRepository";
import { defaultMessCardPresenter } from "./adapters/outbound/mess/formatting/MessCardRenderer";
import { DisplayMessCardTool } from "./tools/DisplayMessCardTool";
import { QueryMessDetailsTool } from "./tools/QueryMessDetailsTool";
import { runDatabaseMigrations } from "./adapters/outbound/chat-repository/postgres/migrator";
import { PostgresAccessControlAdapter } from "./adapters/outbound/access-control/postgres/PostgresAccessControlAdapter";
import { PostgresBaileysSessionManager } from "./adapters/outbound/whatsapp/PostgresBaileysSessionManager";
import { BaileysPairingManager } from "./adapters/outbound/whatsapp/BaileysPairingManager";
import { BaileysConnectionManager } from "./adapters/outbound/whatsapp/BaileysConnectionManager";
import { BaileysMessageSenderAdapter } from "./adapters/outbound/whatsapp/BaileysMessageSenderAdapter";
import { BaileysMessageFilter } from "./adapters/inbound/whatsapp/BaileysMessageFilter";
import { BaileysMessageParser } from "./adapters/inbound/whatsapp/BaileysMessageParser";
import { WhatsAppInboundAdapter } from "./adapters/inbound/whatsapp/WhatsAppInboundAdapter";
import { FoodAnnouncementsInboundAdapter } from "./adapters/inbound/whatsapp/FoodAnnouncementsInboundAdapter";
import { ChatRepositoryContextRetrievalAdapter } from "./adapters/outbound/context-retrieval/ChatRepositoryContextRetrievalAdapter";

const config = loadConfig();
const logger = new PinoLoggerAdapter(config.LOG_LEVEL);
const registry = new InMemoryToolRegistry(logger);
const sqlClient = postgres(config.DATABASE_URL, {
	max: config.DB_MAX_CONNECTIONS,
	idle_timeout: 20,
	connect_timeout: 10,
});
const db = drizzle(sqlClient, {
	schema: { ...chatSchema, ...whatsappSchema, ...accessControlSchema, ...messSchema },
});
const chatRepository = new PostgresChatRepository(db, logger);
const messRepository = new PostgresMessRepository(db, logger.child({ module: "mess-repository" }));
const messStagingRepository = new PostgresMessStagingRepository(
	db,
	logger.child({ module: "mess-staging-repository" }),
);
const displayMessCardTool = new DisplayMessCardTool(messRepository, defaultMessCardPresenter);
const queryMessDetailsTool = new QueryMessDetailsTool(messRepository);
registry.register(displayMessCardTool);
registry.register(queryMessDetailsTool);
const accessControl = new PostgresAccessControlAdapter(
	db,
	logger.child({ module: "access-control" }),
);
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
const contextRetrieval = new ChatRepositoryContextRetrievalAdapter(chatRepository, logger, {
	maxTurns: config.MAX_HISTORY_TURNS,
});
const useCase = new ProcessIncomingMessage(
	messageSender,
	chatRepository,
	contextRetrieval,
	agentLoop,
	registry,
	logger,
);
const inboundAdapter = new WhatsAppInboundAdapter(
	useCase,
	connectionManager,
	accessControl,
	new BaileysMessageFilter(),
	new BaileysMessageParser(),
	logger,
);
const foodAnnouncementsAdapter = new FoodAnnouncementsInboundAdapter({
	targetGroupJid: config.FOOD_ANNOUNCEMENTS_GROUP_JID,
	stagingRepository: messStagingRepository,
	connectionManager,
	logger: logger.child({ module: "food-announcements" }),
});

let isShuttingDown = false;
async function shutdown(signal: string, exitCode = 0) {
	if (isShuttingDown) return;
	isShuttingDown = true;
	logger.info(`Received ${signal}. Closing connections gracefully...`);
	const safe = (p: () => unknown, msg: string) =>
		Promise.resolve()
			.then(p)
			.catch((e) => logger.error(msg, e));
	await Promise.all([
		safe(() => connectionManager.disconnect(), "Error closing WhatsApp connection"),
		safe(() => sqlClient.end({ timeout: 5 }), "Error closing database connection pool"),
	]);
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
		await accessControl.seedUsers(
			config.ALLOWED_USERS.map((phoneNumber, index) => ({
				phoneNumber,
				name: config.ALLOWED_USER_NAMES[index] || null,
			})),
		);
	}
	const count = await accessControl.countActiveUsers();
	if (count === 0) {
		logger.fatal("No active authorized users found. Iny cannot start.");
		await sqlClient.end({ timeout: 5 });
		process.exit(1);
	}
	logger.info("Access control initialized", { activeUsers: count });
	foodAnnouncementsAdapter.start();
	inboundAdapter.start();
	logger.info("Starting Iny WhatsApp connection...");
	const session = await sessionManager.initSession();
	await connectionManager.start({ session, botPhoneNumber: config.BOT_PHONE_NUMBER });
}

start().catch((err) => {
	logger.fatal("Fatal application startup failure", err);
	sqlClient.end({ timeout: 2 }).finally(() => process.exit(1));
});
