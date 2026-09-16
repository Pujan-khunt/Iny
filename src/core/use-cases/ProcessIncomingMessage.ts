import { Message } from '../entities/Message';
import { MessageSenderPort } from '../ports/MessageSenderPort';
import { LLMPort } from '../ports/LLMPort';
import { PluginRegistryPort } from '../ports/PluginRegistryPort';
import { LoggerPort } from '../ports/LoggerPort';

export class ProcessIncomingMessage {
  constructor(
    private sender: MessageSenderPort,
    private llm: LLMPort,
    private registry: PluginRegistryPort,
    private logger: LoggerPort
  ) {}

  async execute(message: Message): Promise<void> {
    const log = this.logger.child({ userId: message.userId, messageId: message.id });
    log.info('Processing incoming message');

    try {
      const plugins = this.registry.getAvailablePlugins();
      log.debug('Available tools discovered', { count: plugins.length });

      // In future: fetch history from ChatRepository here
      const history: Message[] = [];

      const systemPrompt =
        'You are Iny, a friendly and highly concise assistant for college students. Never use emojis and keep answers under 2 sentences.';
      const response = await this.llm.generateResponse(systemPrompt, history, message, plugins);

      if (response.text) {
        await this.sender.sendMessage(message.userId, response.text);
      }

      if (response.toolCall) {
        log.info('Executing tool call', { toolName: response.toolCall.name });
        const toolResult = await this.registry.executePlugin(response.toolCall.name, response.toolCall.arguments);
        // Send tool result back to user for now (later, pass back to LLM for formatting)
        await this.sender.sendMessage(message.userId, toolResult);
      }

      log.info('Message processed successfully');
    } catch (error) {
      log.error('Failed to process message', error);
      await this.sender.sendMessage(message.userId, 'An error occurred during processing.');
    }
  }
}
