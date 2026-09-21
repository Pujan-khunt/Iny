import { Message, UserMessage, AssistantMessage, ToolMessage, ToolCall } from '../entities/Message';
import { DialogueTurn } from '../entities/DialogueTurn';
import { MessageSenderPort } from '../ports/MessageSenderPort';
import { LLMPort } from '../ports/LLMPort';
import { PluginRegistryPort, Plugin } from '../ports/PluginRegistryPort';
import { ChatRepositoryPort } from '../ports/ChatRepositoryPort';
import { LoggerPort } from '../ports/LoggerPort';

export interface ProcessIncomingMessageConfig {
  maxToolIterations?: number;
  maxHistoryTurns?: number;
}

export class ProcessIncomingMessage {
  private maxToolIterations: number;
  private maxHistoryTurns: number;
  private readonly systemPrompt =
    'You are Iny, a friendly and highly concise assistant for college students. Never use emojis and keep answers under 2 sentences.';

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

      const history = await this.loadHistoricalMessages(message.userId);
      const sessionMessages: Message[] = [message];

      const answered = await this.runReActLoop(sessionMessages, history, plugins, log);

      if (!answered) {
        await this.handleCircuitBreaker(sessionMessages, history, plugins, log);
      }

      await this.commitTurn(message.userId, sessionMessages);
      log.info('Message processed successfully');
    } catch (error) {
      log.error('Failed to process message', error);
      await this.sender.sendMessage(message.userId, 'An error occurred during processing.');
    }
  }

  private async loadHistoricalMessages(userId: string): Promise<Message[]> {
    const recentTurns = await this.chatRepository.getRecentTurns(userId, this.maxHistoryTurns);
    return recentTurns.flatMap((turn) => turn.messages);
  }

  private async runReActLoop(
    sessionMessages: Message[],
    history: Message[],
    plugins: Plugin[],
    log: LoggerPort
  ): Promise<boolean> {
    const userId = sessionMessages[0].userId;
    let iteration = 0;

    while (iteration < this.maxToolIterations) {
      const workingHistory = [...history, ...sessionMessages];
      const response = await this.llm.generateResponse(this.systemPrompt, workingHistory, plugins);

      if (response.type === 'text') {
        await this.handleFinalTextResponse(userId, response.content, response.thought, sessionMessages);
        return true;
      }

      if (response.type === 'tool_calls') {
        await this.handleToolCallsStep(userId, response.toolCalls, response.thought, sessionMessages, log);
        iteration++;
      }
    }

    return false;
  }

  private async handleFinalTextResponse(
    userId: string,
    content: string,
    thought: string | undefined,
    sessionMessages: Message[]
  ): Promise<void> {
    const assistantMessage: AssistantMessage = {
      id: crypto.randomUUID(),
      userId,
      role: 'assistant',
      content,
      thought,
      timestamp: new Date(),
    };
    sessionMessages.push(assistantMessage);
    await this.sender.sendMessage(userId, content);
  }

  private async handleToolCallsStep(
    userId: string,
    toolCalls: ToolCall[],
    thought: string | undefined,
    sessionMessages: Message[],
    log: LoggerPort
  ): Promise<void> {
    const assistantMessage: AssistantMessage = {
      id: crypto.randomUUID(),
      userId,
      role: 'assistant',
      thought,
      toolCalls,
      timestamp: new Date(),
    };
    sessionMessages.push(assistantMessage);

    const toolMessages = await this.executeToolsConcurrently(userId, toolCalls, log);
    sessionMessages.push(...toolMessages);
  }

  private async executeToolsConcurrently(
    userId: string,
    toolCalls: ToolCall[],
    log: LoggerPort
  ): Promise<ToolMessage[]> {
    return Promise.all(
      toolCalls.map(async (tc): Promise<ToolMessage> => {
        try {
          log.info('Executing tool call', { toolName: tc.name });
          const result = await this.registry.executePlugin(tc.name, tc.arguments);
          return {
            id: crypto.randomUUID(),
            userId,
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
            userId,
            role: 'tool',
            toolCallId: tc.id,
            name: tc.name,
            content: `Error executing tool '${tc.name}': ${errorMessage}`,
            timestamp: new Date(),
          };
        }
      })
    );
  }

  private async handleCircuitBreaker(
    sessionMessages: Message[],
    history: Message[],
    plugins: Plugin[],
    log: LoggerPort
  ): Promise<void> {
    const userId = sessionMessages[0].userId;
    log.warn('Max tool iterations reached, forcing synthesis', {
      maxIterations: this.maxToolIterations,
    });

    const workingHistory = [...history, ...sessionMessages];
    const forcedResponse = await this.llm.generateResponse(
      this.systemPrompt,
      workingHistory,
      plugins,
      { forcedSynthesis: true }
    );

    const rawContent = forcedResponse.type === 'text' ? forcedResponse.content : '';
    const content =
      rawContent.trim() !== ''
        ? rawContent
        : "I've reached the maximum number of tool iterations and was unable to complete your request.";

    const assistantMessage: AssistantMessage = {
      id: crypto.randomUUID(),
      userId,
      role: 'assistant',
      content,
      thought: forcedResponse.thought,
      timestamp: new Date(),
    };
    sessionMessages.push(assistantMessage);
    await this.sender.sendMessage(userId, content);
  }

  private async commitTurn(userId: string, sessionMessages: Message[]): Promise<void> {
    const completedTurn: DialogueTurn = {
      id: crypto.randomUUID(),
      userId,
      messages: sessionMessages,
      createdAt: new Date(),
    };
    await this.chatRepository.saveTurn(completedTurn);
  }
}
