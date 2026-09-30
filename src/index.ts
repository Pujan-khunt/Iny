import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ProcessIncomingMessage } from './core/use-cases/ProcessIncomingMessage';
import { AgentLoop } from './core/use-cases/AgentLoop';
import { config } from './config';
import { DeepseekAdapter } from './adapters/outbound/llm/DeepseekAdapter';
import { InMemoryToolRegistry } from './adapters/outbound/tool-registry/InMemoryToolRegistry';
import { CalculatorTool } from './tools/CalculatorTool';
import { PinoLoggerAdapter } from './adapters/outbound/logger/PinoLoggerAdapter';
import * as chatSchema from './adapters/outbound/chat-repository/postgres/schema';
import * as whatsappSchema from './adapters/outbound/whatsapp/postgres/schema';
import { PostgresChatRepository } from './adapters/outbound/chat-repository/postgres/PostgresChatRepository';
import { runDatabaseMigrations } from './adapters/outbound/chat-repository/postgres/migrator';
import { WhatsAppAllowlist } from './adapters/common/access-control/WhatsAppAllowlist';
import { PostgresBaileysSessionManager } from './adapters/outbound/whatsapp/PostgresBaileysSessionManager';
import { BaileysPairingManager } from './adapters/outbound/whatsapp/BaileysPairingManager';
import { BaileysConnectionManager } from './adapters/outbound/whatsapp/BaileysConnectionManager';
import { BaileysMessageSenderAdapter } from './adapters/outbound/whatsapp/BaileysMessageSenderAdapter';
import { BaileysMessageFilter } from './adapters/inbound/whatsapp/BaileysMessageFilter';
import { BaileysMessageParser } from './adapters/inbound/whatsapp/BaileysMessageParser';
import { WhatsAppInboundAdapter } from './adapters/inbound/whatsapp/WhatsAppInboundAdapter';

// 1. Logger
const logger = new PinoLoggerAdapter(config.LOG_LEVEL);

// 2. Access control allowlist
const allowlist = new WhatsAppAllowlist(config.ALLOWED_USERS);

// 3. Outbound tool registry & tools
const registry = new InMemoryToolRegistry(logger);
registry.register(new CalculatorTool());

// 4. PostgreSQL Connection Pool & Drizzle ORM
const sqlClient = postgres(config.DATABASE_URL, {
  max: config.DB_MAX_CONNECTIONS,
  idle_timeout: 20,
  connect_timeout: 10,
});
const db = drizzle(sqlClient, {
  schema: { ...chatSchema, ...whatsappSchema },
});
const chatRepository = new PostgresChatRepository(db, logger);

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
const messageSender = new BaileysMessageSenderAdapter(connectionManager, allowlist, logger);

// 7. Autonomous AgentLoop
const agentLoop = new AgentLoop(deepseekAdapter, registry, {
  maxToolIterations: config.MAX_TOOL_ITERATIONS,
  systemPrompt: config.SYSTEM_PROMPT,
});

// 8. Orchestrating ProcessIncomingMessage use case
const useCase = new ProcessIncomingMessage(
  messageSender,
  chatRepository,
  agentLoop,
  registry,
  logger,
  {
    maxHistoryTurns: config.MAX_HISTORY_TURNS,
  }
);

// 9. Inbound WhatsApp Driving Adapter
const filter = new BaileysMessageFilter();
const parser = new BaileysMessageParser();
const inboundAdapter = new WhatsAppInboundAdapter(
  useCase,
  connectionManager,
  allowlist,
  filter,
  parser,
  logger
);

// Graceful Shutdown
async function shutdown(signal: string) {
  logger.info(`Received ${signal}. Closing connections gracefully...`);
  try {
    const socket = connectionManager.getSocket();
    if (socket) {
      socket.end(undefined);
    }
  } catch (err) {
    logger.error('Error closing WhatsApp socket during shutdown', err);
  }
  try {
    await sqlClient.end({ timeout: 5 });
    logger.info('Database connection pool closed');
  } catch (err) {
    logger.error('Error closing database connection pool', err);
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Startup Sequence
async function start() {
  await runDatabaseMigrations(db, logger);

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
