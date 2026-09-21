import { Message, UserMessage, AssistantMessage, ToolMessage } from '../entities/Message';
import { DialogueTurn } from '../entities/DialogueTurn';
import { MessageSenderPort } from '../ports/MessageSenderPort';
import { LLMPort } from '../ports/LLMPort';
import { PluginRegistryPort } from '../ports/PluginRegistryPort';
import { ChatRepositoryPort } from '../ports/ChatRepositoryPort';
import { LoggerPort } from '../ports/LoggerPort';

export interface ProcessIncomingMessageConfig {
  maxToolIterations?: number;
  maxHistoryTurns?: number;
}

export class ProcessIncomingMessage {
  private maxToolIterations: number;
  private maxHistoryTurns: number;

  constructor(
    private sender: MessageSenderPort,
    private llm: LLMPort,
    private registry: PluginRegistryPort,
    private chatRepository: ChatRepositoryPort,
    private logger: LoggerPort,
    config?: ProcessIncomingMessageConfig
  ) {
    this.maxToolIterations = config?.maxToolIterations ?? 5;
    this.maxHistoryTurns = config?.maxHistoryTurns ?? 10;
  }

  async execute(message: UserMessage): Promise<void> {
    const log = this.logger.child({ userId: message.userId, messageId: message.id });
    log.info('Processing incoming message');

    try {
      const plugins = this.registry.getAvailablePlugins();
      log.debug('Available tools discovered', { count: plugins.length });

      const recentTurns = await this.chatRepository.getRecentTurns(
        message.userId,
        this.maxHistoryTurns
      );
      const history: Message[] = recentTurns.flatMap((t) => t.messages);

      const systemPrompt =
        'You are Iny, a friendly and highly concise assistant for college students. Never use emojis and keep answers under 2 sentences.';

      const sessionMessages: Message[] = [message];
      let iteration = 0;
      let answered = false;

      while (iteration < this.maxToolIterations) {
        const workingHistory = [...history, ...sessionMessages];
        const response = await this.llm.generateResponse(systemPrompt, workingHistory, plugins);

        if (response.type === 'text') {
          const assistantMessage: AssistantMessage = {
            id: crypto.randomUUID(),
            userId: message.userId,
            role: 'assistant',
            content: response.content,
            thought: response.thought,
            timestamp: new Date(),
          };
          sessionMessages.push(assistantMessage);
          await this.sender.sendMessage(message.userId, response.content);
          answered = true;
          break;
        }

        if (response.type === 'tool_calls') {
          const assistantMessage: AssistantMessage = {
            id: crypto.randomUUID(),
            userId: message.userId,
            role: 'assistant',
            thought: response.thought,
            toolCalls: response.toolCalls,
            timestamp: new Date(),
          };
          sessionMessages.push(assistantMessage);

          const toolMessages = await Promise.all(
            response.toolCalls.map(async (tc): Promise<ToolMessage> => {
              try {
                log.info('Executing tool call', { toolName: tc.name });
                const result = await this.registry.executePlugin(tc.name, tc.arguments);
                return {
                  id: crypto.randomUUID(),
                  userId: message.userId,
                  role: 'tool',
                  toolCallId: tc.id,
                  name: tc.name,
                  content: result,
                  timestamp: new Date(),
                };
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log.warn('Tool execution failed', { toolName: tc.name, error: errorMessage });
                return {
                  id: crypto.randomUUID(),
                  userId: message.userId,
                  role: 'tool',
                  toolCallId: tc.id,
                  name: tc.name,
                  content: `Error executing tool '${tc.name}': ${errorMessage}`,
                  timestamp: new Date(),
                };
              }
            })
          );

          sessionMessages.push(...toolMessages);
          iteration++;
        }
      }

      if (!answered) {
        log.warn('Max tool iterations reached, forcing synthesis', { iterations: iteration });
        const workingHistory = [...history, ...sessionMessages];
        const forcedResponse = await this.llm.generateResponse(
          systemPrompt,
          workingHistory,
          plugins,
          { forcedSynthesis: true }
        );

        const content = forcedResponse.type === 'text' ? forcedResponse.content : '';
        const assistantMessage: AssistantMessage = {
          id: crypto.randomUUID(),
          userId: message.userId,
          role: 'assistant',
          content,
          thought: forcedResponse.thought,
          timestamp: new Date(),
        };
        sessionMessages.push(assistantMessage);
        await this.sender.sendMessage(message.userId, content);
      }

      const completedTurn: DialogueTurn = {
        id: crypto.randomUUID(),
        userId: message.userId,
        messages: sessionMessages,
        createdAt: new Date(),
      };
      await this.chatRepository.saveTurn(completedTurn);

      log.info('Message processed successfully');
    } catch (error) {
      log.error('Failed to process message', error);
      await this.sender.sendMessage(message.userId, 'An error occurred during processing.');
    }
  }
}
