import { ProcessIncomingMessage } from './core/use-cases/ProcessIncomingMessage';
import { AgentLoop } from './core/use-cases/AgentLoop';
import { config } from './config';
import { DeepseekAdapter } from './adapters/outbound/llm/DeepseekAdapter';
import { InMemoryToolRegistry } from './adapters/outbound/tool-registry/InMemoryToolRegistry';
import { CalculatorTool } from './tools/CalculatorTool';
import { PinoLoggerAdapter } from './adapters/outbound/logger/PinoLoggerAdapter';
import { InMemoryChatRepository } from './adapters/outbound/chat-repository/InMemoryChatRepository';
import { WhatsAppAllowlist } from './adapters/common/access-control/WhatsAppAllowlist';
import { BaileysSessionManager } from './adapters/outbound/whatsapp/BaileysSessionManager';
import { BaileysPairingManager } from './adapters/outbound/whatsapp/BaileysPairingManager';
import { BaileysConnectionManager } from './adapters/outbound/whatsapp/BaileysConnectionManager';
import { BaileysMessageSenderAdapter } from './adapters/outbound/whatsapp/BaileysMessageSenderAdapter';
import { BaileysMessageParser } from './adapters/inbound/whatsapp/BaileysMessageParser';
import { WhatsAppInboundAdapter } from './adapters/inbound/whatsapp/WhatsAppInboundAdapter';

/**
 * Composition root for the Iny WhatsApp application.
 */

// 1. Logger
const logger = new PinoLoggerAdapter(config.LOG_LEVEL);

// 2. Access control allowlist
const allowlist = new WhatsAppAllowlist(config.ALLOWED_USERS);

// 3. Outbound tool registry & tools
const registry = new InMemoryToolRegistry(logger);
registry.register(new CalculatorTool());

// 4. Conversation history repository & LLM adapter
const chatRepository = new InMemoryChatRepository();
const deepseekAdapter = new DeepseekAdapter(config.DEEPSEEK_API_KEY, {
  baseURL: config.DEEPSEEK_BASE_URL,
  model: config.DEEPSEEK_MODEL,
  logger,
});

// 5. WhatsApp Infrastructure & Message Sender
const sessionManager = new BaileysSessionManager(logger);
const pairingManager = new BaileysPairingManager(logger);
const connectionManager = new BaileysConnectionManager(logger, pairingManager, sessionManager);
const messageSender = new BaileysMessageSenderAdapter(connectionManager, allowlist, logger);

// 6. Autonomous AgentLoop
const agentLoop = new AgentLoop(deepseekAdapter, registry, {
  maxToolIterations: config.MAX_TOOL_ITERATIONS,
  systemPrompt: config.SYSTEM_PROMPT,
});

// 7. Orchestrating ProcessIncomingMessage use case
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

// 8. Inbound WhatsApp Driving Adapter
const parser = new BaileysMessageParser();
const inboundAdapter = new WhatsAppInboundAdapter(
  useCase,
  connectionManager,
  allowlist,
  parser,
  logger
);

inboundAdapter.start();

logger.info('Starting Iny WhatsApp connection...');
sessionManager
  .initSession()
  .then((session) =>
    connectionManager.start({
      session,
      botPhoneNumber: config.BOT_PHONE_NUMBER,
    })
  )
  .catch((err) => {
    logger.fatal('Failed to initialize WhatsApp connection', err);
    process.exit(1);
  });
