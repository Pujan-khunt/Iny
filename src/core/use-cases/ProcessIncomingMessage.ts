import { Message } from '../entities/Message';
import { MessageSenderPort } from '../ports/MessageSenderPort';
import { LLMPort } from '../ports/LLMPort';
import { PluginRegistryPort } from '../ports/PluginRegistryPort';

export class ProcessIncomingMessage {
  constructor(
    private sender: MessageSenderPort,
    private llm: LLMPort,
    private registry: PluginRegistryPort
  ) {}

  async execute(message: Message): Promise<void> {
    try {
      const plugins = this.registry.getAvailablePlugins();
      // In future: fetch history from ChatRepository here
      const history: Message[] = [];

      const systemPrompt =
        'You are Iny, a friendly and highly concise assistant for college students. Never use emojis and keep answers under 2 sentences.';
      const response = await this.llm.generateResponse(systemPrompt, history, message, plugins);

      if (response.text) {
        await this.sender.sendMessage(message.userId, response.text);
      }

      if (response.toolCall) {
        const toolResult = await this.registry.executePlugin(response.toolCall.name, response.toolCall.arguments);
        // Send tool result back to user for now (later, pass back to LLM for formatting)
        await this.sender.sendMessage(message.userId, toolResult);
      }
    } catch (error) {
      await this.sender.sendMessage(message.userId, 'An error occurred during processing.');
    }
  }
}
