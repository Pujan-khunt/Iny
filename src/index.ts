import { ProcessIncomingMessage } from './core/use-cases/ProcessIncomingMessage';
import { AgentLoop } from './core/use-cases/AgentLoop';
import { CLIAdapter } from './adapters/inbound/cli/CLIAdapter';
import { config } from './config';
import { DeepseekAdapter } from './adapters/outbound/llm/DeepseekAdapter';
import { InMemoryToolRegistry } from './adapters/outbound/tool-registry/InMemoryToolRegistry';
import { CalculatorTool } from './tools/CalculatorTool';
import { PinoLoggerAdapter } from './adapters/outbound/logger/PinoLoggerAdapter';
import { InMemoryChatRepository } from './adapters/outbound/chat-repository/InMemoryChatRepository';

const logger = new PinoLoggerAdapter(config.LOG_LEVEL);

const mockSender = {
  sendMessage: async (userId: string, text: string) => {
    console.log(`\n[Iny -> ${userId}]: ${text}\n`);
  },
};

const registry = new InMemoryToolRegistry(logger);
registry.register(new CalculatorTool());

const chatRepository = new InMemoryChatRepository();
const deepseekAdapter = new DeepseekAdapter(config.DEEPSEEK_API_KEY, {
  baseURL: config.DEEPSEEK_BASE_URL,
  model: config.DEEPSEEK_MODEL,
  logger,
});

const agentLoop = new AgentLoop(deepseekAdapter, registry, {
  maxToolIterations: config.MAX_TOOL_ITERATIONS,
  systemPrompt: config.SYSTEM_PROMPT,
});

const useCase = new ProcessIncomingMessage(
  mockSender,
  chatRepository,
  agentLoop,
  registry,
  logger,
  {
    maxHistoryTurns: config.MAX_HISTORY_TURNS,
  }
);
const cli = new CLIAdapter(useCase, { logger });

logger.info('Iny application started');
cli.start();
