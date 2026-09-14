import { ProcessIncomingMessage } from './core/use-cases/ProcessIncomingMessage';
import { CLIAdapter } from './adapters/driving/cli/CLIAdapter';

const mockSender = {
  sendMessage: async (userId: string, text: string) => {
    console.log(`\n[Iny -> ${userId}]: ${text}\n`);
  }
};

const mockLLM = {
  generateResponse: async (systemPrompt: string, history: any[], newMessage: any, plugins: any[]) => ({ text: 'I am a mock LLM.' })
};

const mockRegistry = {
  getAvailablePlugins: () => [],
  executePlugin: async () => ''
};

const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry);
const cli = new CLIAdapter(useCase);
cli.start();
