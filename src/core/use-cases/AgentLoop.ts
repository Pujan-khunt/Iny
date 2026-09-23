import {
  Message,
  UserMessage,
  AssistantTextMessage,
  AssistantToolCallMessage,
  ToolMessage,
} from '../entities/Message';
import { ToolCall } from '../entities/ToolCall';
import { LLMPort } from '../ports/LLMPort';
import { ToolRegistryPort, ToolDefinition } from '../ports/ToolRegistryPort';
import { LoggerPort } from '../ports/LoggerPort';

export interface AgentLoopConfig {
  systemPrompt: string;
  maxToolIterations?: number;
}

export interface AgentLoopResult {
  finalText: string;
  thought?: string;
  sessionMessages: Message[];
}

export class AgentLoop {
  private readonly maxToolIterations: number;
  private readonly systemPrompt: string;

  constructor(
    private llm: LLMPort,
    private registry: ToolRegistryPort,
    config: AgentLoopConfig
  ) {
    this.systemPrompt = config.systemPrompt;
    this.maxToolIterations = config.maxToolIterations ?? 5;
  }

  async run(
    userMessage: UserMessage,
    history: Message[],
    tools: ToolDefinition[],
    log: LoggerPort
  ): Promise<AgentLoopResult> {
    const sessionMessages: Message[] = [userMessage];
    let iteration = 0;

    while (iteration < this.maxToolIterations) {
      const workingMessages = [...history, ...sessionMessages];
      const response = await this.llm.generateResponse(
        this.systemPrompt,
        workingMessages,
        tools
      );

      if (response.type === 'text') {
        const content =
          response.content.trim() !== ''
            ? response.content
            : 'I apologize, but I was unable to formulate a response.';
        const assistantMessage: AssistantTextMessage = {
          id: crypto.randomUUID(),
          userId: userMessage.userId,
          role: 'assistant',
          content,
          thought: response.thought,
          timestamp: new Date(),
        };
        sessionMessages.push(assistantMessage);
        return { finalText: content, thought: response.thought, sessionMessages };
      }

      // Handle tool calls step
      const toolCallMessage: AssistantToolCallMessage = {
        id: crypto.randomUUID(),
        userId: userMessage.userId,
        role: 'assistant',
        thought: response.thought,
        toolCalls: response.toolCalls,
        timestamp: new Date(),
      };
      sessionMessages.push(toolCallMessage);

      const toolResults = await this.executeToolsConcurrently(
        userMessage.userId,
        response.toolCalls,
        log
      );
      sessionMessages.push(...toolResults);
      iteration++;
    }

    // Circuit breaker forced synthesis
    return this.handleCircuitBreaker(userMessage.userId, history, sessionMessages, tools, log);
  }

  private async executeToolsConcurrently(
    userId: string,
    toolCalls: ToolCall[],
    log: LoggerPort
  ): Promise<ToolMessage[]> {
    return Promise.all(
      toolCalls.map(async (tc): Promise<ToolMessage> => {
        if (tc.type === 'malformed') {
          log.warn('Tool call arguments were malformed', undefined, {
            toolName: tc.name,
            parseError: tc.parseError,
          });
          return {
            id: crypto.randomUUID(),
            userId,
            role: 'tool',
            toolCallId: tc.id,
            name: tc.name,
            content: `Error executing tool '${tc.name}': Failed to parse tool arguments: ${tc.parseError}`,
            timestamp: new Date(),
          };
        }

        try {
          log.info('Executing tool call', { toolName: tc.name });
          const result = await this.registry.executeTool(tc.name, tc.arguments);
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
          log.warn('Tool execution failed', error, { toolName: tc.name });
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
    userId: string,
    history: Message[],
    sessionMessages: Message[],
    tools: ToolDefinition[],
    log: LoggerPort
  ): Promise<AgentLoopResult> {
    log.warn('Max tool iterations reached, forcing synthesis', undefined, {
      maxIterations: this.maxToolIterations,
    });

    const workingMessages = [...history, ...sessionMessages];
    const forcedResponse = await this.llm.generateResponse(
      this.systemPrompt,
      workingMessages,
      tools,
      { forcedSynthesis: true }
    );

    const rawContent = forcedResponse.type === 'text' ? forcedResponse.content : '';
    const content =
      rawContent.trim() !== ''
        ? rawContent
        : "I've reached the maximum number of tool iterations and was unable to complete your request.";

    const assistantMessage: AssistantTextMessage = {
      id: crypto.randomUUID(),
      userId,
      role: 'assistant',
      content,
      thought: forcedResponse.thought,
      timestamp: new Date(),
    };
    sessionMessages.push(assistantMessage);

    return { finalText: content, thought: forcedResponse.thought, sessionMessages };
  }
}
