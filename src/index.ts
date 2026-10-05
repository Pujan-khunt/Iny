import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ProcessIncomingMessage } from './core/use-cases/ProcessIncomingMessage';
import { AgentLoop } from './core/use-cases/AgentLoop';
import { loadConfig } from './config';
import { DeepseekAdapter } from './adapters/outbound/llm/DeepseekAdapter';
import { InMemoryToolRegistry } from './adapters/outbound/tool-registry/InMemoryToolRegistry';
import { CalculatorTool } from './tools/CalculatorTool';
import { PinoLoggerAdapter } from './adapters/outbound/logger/PinoLoggerAdapter';
import * as chatSchema from './adapters/outbound/chat-repository/postgres/schema';
import * as whatsappSchema from './adapters/outbound/whatsapp/postgres/schema';
import * as accessControlSchema from './adapters/outbound/access-control/postgres/schema';
import { PostgresChatRepository } from './adapters/outbound/chat-repository/postgres/PostgresChatRepository';
import { runDatabaseMigrations } from './adapters/outbound/chat-repository/postgres/migrator';
import { PostgresAccessControlAdapter } from './adapters/outbound/access-control/postgres/PostgresAccessControlAdapter';
import { PostgresBaileysSessionManager } from './adapters/outbound/whatsapp/PostgresBaileysSessionManager';
import { BaileysPairingManager } from './adapters/outbound/whatsapp/BaileysPairingManager';
import { BaileysConnectionManager } from './adapters/outbound/whatsapp/BaileysConnectionManager';
import { BaileysMessageSenderAdapter } from './adapters/outbound/whatsapp/BaileysMessageSenderAdapter';
import { BaileysMessageFilter } from './adapters/inbound/whatsapp/BaileysMessageFilter';
import { BaileysMessageParser } from './adapters/inbound/whatsapp/BaileysMessageParser';
import { WhatsAppInboundAdapter } from './adapters/inbound/whatsapp/WhatsAppInboundAdapter';
import { ChatRepositoryContextRetrievalAdapter } from './adapters/outbound/context-retrieval/ChatRepositoryContextRetrievalAdapter';

// Load & validate application configuration from environment
const config = loadConfig();

// 1. Logger
const logger = new PinoLoggerAdapter(config.LOG_LEVEL);

// 2. Outbound tool registry & tools
const registry = new InMemoryToolRegistry(logger);
registry.register(new CalculatorTool());

// 3. PostgreSQL Connection Pool & Drizzle ORM
const sqlClient = postgres(config.DATABASE_URL, {
  max: config.DB_MAX_CONNECTIONS,
  idle_timeout: 20,
  connect_timeout: 10,
});
const db = drizzle(sqlClient, {
  schema: { ...chatSchema, ...whatsappSchema, ...accessControlSchema },
});


const chatRepository = new PostgresChatRepository(db, logger);

// 4. Access control
const accessControl = new PostgresAccessControlAdapter(db, logger.child({ module: 'access-control' }));

// 5. LLM Adapter
const deepseekAdapter = new DeepseekAdapter(config.DEEPSEEK_API_KEY, {
  baseURL: config.DEEPSEEK_BASE_URL,
  model: config.DEEPSEEK_MODEL,
  logger,
});

// 6. WhatsApp Infrastructure & Message Sender
const sessionManager = new PostgresBaileysSessionManager(db, logger, 'default');
const pairingManager = new BaileysPairingManager(logger);
const connectionManager = new BaileysConnectionManager(logger, pairingManager, sessionManager);
const messageSender = new BaileysMessageSenderAdapter(connectionManager, logger);

// 7. Autonomous AgentLoop
const agentLoop = new AgentLoop(deepseekAdapter, registry, {
  maxToolIterations: config.MAX_TOOL_ITERATIONS,
  systemPrompt: config.SYSTEM_PROMPT,
});

// 8. Context Retrieval & Orchestrating ProcessIncomingMessage use case
const contextRetrieval = new ChatRepositoryContextRetrievalAdapter(chatRepository, logger, {
  maxTurns: config.MAX_HISTORY_TURNS,
});

const useCase = new ProcessIncomingMessage(
  messageSender,
  chatRepository,
  contextRetrieval,
  agentLoop,
  registry,
  logger
);

// 9. Inbound WhatsApp Driving Adapter
const filter = new BaileysMessageFilter();
const parser = new BaileysMessageParser();
const inboundAdapter = new WhatsAppInboundAdapter(
  useCase,
  connectionManager,
  accessControl,
  filter,
  parser,
  logger
);

// Graceful Shutdown
let isShuttingDown = false;

async function shutdown(signal: string, exitCode = 0) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info(`Received ${signal}. Closing connections gracefully...`);
  try {
    connectionManager.disconnect();
  } catch (err) {
    logger.error('Error closing WhatsApp connection during shutdown', err);
  }
  try {
    await sqlClient.end({ timeout: 5 });
    logger.info('Database connection pool closed');
  } catch (err) {
    logger.error('Error closing database connection pool', err);
  }
  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown('SIGINT', 0));
process.on('SIGTERM', () => shutdown('SIGTERM', 0));

process.on('uncaughtException', (err) => {
  logger.fatal('Uncaught exception', err);
  shutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logger.fatal('Unhandled promise rejection', error);
  shutdown('unhandledRejection', 1);
});

// Startup Sequence
async function start() {
  await runDatabaseMigrations(db, logger);

  // Seed initial admin users from configuration if provided
  if (config.ALLOWED_USERS.length > 0) {
    const seedEntries = config.ALLOWED_USERS.map((phoneNumber, index) => ({
      phoneNumber,
      name: config.ALLOWED_USER_NAMES[index] || null,
    }));
    await accessControl.seedUsers(seedEntries);
  }

  // Fail-fast safety check: ensure at least one active user exists
  const activeUserCount = await accessControl.countActiveUsers();
  if (activeUserCount === 0) {
    logger.fatal(
      'No active authorized users found in PostgreSQL and no ALLOWED_USERS provided in .env. Iny cannot start.'
    );
    await sqlClient.end({ timeout: 5 });
    process.exit(1);
  }
  logger.info('Access control initialized', { activeUsers: activeUserCount });

  inboundAdapter.start();

  logger.info('Starting Iny WhatsApp connection...');
  const session = await sessionManager.initSession();
  await connectionManager.start({
    session,
    botPhoneNumber: config.BOT_PHONE_NUMBER,
  });
}

start().catch((err) => {
  logger.fatal('Fatal application startup failure', err);
  sqlClient.end({ timeout: 2 }).finally(() => process.exit(1));
});
