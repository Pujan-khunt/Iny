import { ProcessIncomingMessage } from './core/use-cases/ProcessIncomingMessage';
import { CLIAdapter } from './adapters/inbound/cli/CLIAdapter';
import { config } from './config';
import { DeepseekAdapter } from './adapters/outbound/llm/DeepseekAdapter';
import { InMemoryPluginRegistry } from './adapters/outbound/plugin-registry/InMemoryPluginRegistry';
import { CalculatorPlugin } from './plugins/CalculatorPlugin';
import { PinoLoggerAdapter } from './adapters/outbound/logger/PinoLoggerAdapter';

const logger = new PinoLoggerAdapter(config.LOG_LEVEL);

const mockSender = {
  sendMessage: async (userId: string, text: string) => {
    console.log(`\n[Iny -> ${userId}]: ${text}\n`);
  }
};

const registry = new InMemoryPluginRegistry(logger);
registry.register(new CalculatorPlugin());

const deepseekAdapter = new DeepseekAdapter(config.DEEPSEEK_API_KEY, logger);
const useCase = new ProcessIncomingMessage(mockSender, deepseekAdapter, registry, logger);
const cli = new CLIAdapter(useCase, { logger });

logger.info('Iny application started');
cli.start();
