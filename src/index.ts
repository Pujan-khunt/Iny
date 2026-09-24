import { ProcessIncomingMessage } from './core/use-cases/ProcessIncomingMessage';
import { AgentLoop } from './core/use-cases/AgentLoop';
import { CLIAdapter } from './adapters/inbound/cli/CLIAdapter';
import { config } from './config';
import { DeepseekAdapter } from './adapters/outbound/llm/DeepseekAdapter';
import { InMemoryToolRegistry } from './adapters/outbound/tool-registry/InMemoryToolRegistry';
import { CalculatorTool } from './tools/CalculatorTool';
import { PinoLoggerAdapter } from './adapters/outbound/logger/PinoLoggerAdapter';
import { InMemoryChatRepository } from './adapters/outbound/chat-repository/InMemoryChatRepository';
import { MessageSenderPort } from './core/ports/MessageSenderPort';

/**
 * Composition root for the Iny application.
 * Assembles outbound infrastructure adapters, initializes core domain use cases,
 * and boots the inbound CLI driving adapter.
 */

// 1. Logger adapter
const logger = new PinoLoggerAdapter(config.LOG_LEVEL);

/**
 * Outbound message sender adapter that outputs responses directly to the console.
 */
const consoleSender: MessageSenderPort = {
  sendMessage: async (userId: string, content: string): Promise<void> => {
    console.log(`\n[Iny -> ${userId}]: ${content}\n`);
  },
};

// 2. Outbound tool registry and tool registrations
const registry = new InMemoryToolRegistry(logger);
registry.register(new CalculatorTool());

// 3. Conversation history repository and LLM adapter
const chatRepository = new InMemoryChatRepository();
const deepseekAdapter = new DeepseekAdapter(config.DEEPSEEK_API_KEY, {
  baseURL: config.DEEPSEEK_BASE_URL,
  model: config.DEEPSEEK_MODEL,
  logger,
});

// 4. Autonomous AgentLoop use case
const agentLoop = new AgentLoop(deepseekAdapter, registry, {
  maxToolIterations: config.MAX_TOOL_ITERATIONS,
  systemPrompt: config.SYSTEM_PROMPT,
});

// 5. Orchestrating ProcessIncomingMessage use case
const useCase = new ProcessIncomingMessage(
  consoleSender,
  chatRepository,
  agentLoop,
  registry,
  logger,
  {
    maxHistoryTurns: config.MAX_HISTORY_TURNS,
  }
);

// 6. Inbound CLI driving adapter
const cli = new CLIAdapter(useCase, { logger });

logger.info('Iny application started');
cli.start();

