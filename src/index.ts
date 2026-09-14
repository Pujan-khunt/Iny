import { ProcessIncomingMessage } from './core/use-cases/ProcessIncomingMessage';
import { CLIAdapter } from './adapters/driving/cli/CLIAdapter';
import { config } from './config';
import { DeepseekAdapter } from './adapters/driven/llm/DeepseekAdapter';

const mockSender = {
  sendMessage: async (userId: string, text: string) => {
    console.log(`\n[Iny -> ${userId}]: ${text}\n`);
  }
};

const mockRegistry = {
  getAvailablePlugins: () => [],
  executePlugin: async () => ''
};

const deepseekAdapter = new DeepseekAdapter(config.DEEPSEEK_API_KEY);
const useCase = new ProcessIncomingMessage(mockSender, deepseekAdapter, mockRegistry);
const cli = new CLIAdapter(useCase);
cli.start();
