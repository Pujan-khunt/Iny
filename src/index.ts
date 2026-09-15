import { ProcessIncomingMessage } from './core/use-cases/ProcessIncomingMessage';
import { CLIAdapter } from './adapters/driving/cli/CLIAdapter';
import { config } from './config';
import { DeepseekAdapter } from './adapters/driven/llm/DeepseekAdapter';
import { InMemoryPluginRegistry } from './adapters/driven/plugin-registry/InMemoryPluginRegistry';
import { CalculatorPlugin } from './plugins/CalculatorPlugin';

const mockSender = {
  sendMessage: async (userId: string, text: string) => {
    console.log(`\n[Iny -> ${userId}]: ${text}\n`);
  }
};

const registry = new InMemoryPluginRegistry();
registry.register(new CalculatorPlugin());

const deepseekAdapter = new DeepseekAdapter(config.DEEPSEEK_API_KEY);
const useCase = new ProcessIncomingMessage(mockSender, deepseekAdapter, registry);
const cli = new CLIAdapter(useCase);
cli.start();
