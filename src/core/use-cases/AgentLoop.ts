import {
  Message,
  UserMessage,
  MessageFactory,
  ToolResultMessage,
} from '../entities/Message';
import { ToolCallRequest } from '../entities/ToolCallRequest';
import { LLMPort } from '../ports/LLMPort';
import { ToolRegistryPort, ToolDefinition } from '../ports/ToolRegistryPort';
import { LoggerPort } from '../ports/LoggerPort';

/**
 * Configuration options for the ReAct reasoning agent loop.
 */
export interface AgentLoopConfig {
  /** Static system prompt instructing the language model on persona and rules. */
  systemPrompt: string;
  /** Maximum number of tool execution cycles before forcing text synthesis. Defaults to 5. */
  maxToolIterations?: number;
}

/**
 * Encapsulates the outcome of an AgentLoop execution cycle.
 */
export interface AgentLoopResult {
  /** The final natural language response synthesized by the model. */
  finalText: string;
  /** Optional chain-of-thought or reasoning scratchpad emitted by the model. */
  thought?: string;
  /** All intermediate messages generated during this turn (assistant tool calls, tool results, final text). */
  sessionMessages: Message[];
}

/**
 * Pure domain service executing the ReAct (Reasoning + Acting) loop.
 * Coordinates multi-turn LLM reasoning, concurrent tool execution via Promise.all,
 * malformed argument reflection, and circuit-breaker forced synthesis.
 */
export class AgentLoop {
  private readonly maxToolIterations: number;
  private readonly systemPrompt: string;

  /**
   * Initializes a new AgentLoop domain service instance.
   *
   * @param llm Outbound port for interacting with the language model provider.
   * @param registry Outbound port for discovering and executing domain tools.
   * @param config Agent loop operational parameters (system prompt, iteration limit).
   */
  constructor(
    private llm: LLMPort,
    private registry: ToolRegistryPort,
    config: AgentLoopConfig
  ) {
    this.systemPrompt = config.systemPrompt;
    this.maxToolIterations = config.maxToolIterations ?? 5;
  }

  /**
   * Runs the ReAct reasoning loop until the model produces a text response or reaches max iterations.
   *
   * @param userMessage Inbound user message triggering this dialogue exchange.
   * @param history Prior dialogue turns loaded from conversation history.
   * @param tools Available tool definitions formatted for model function calling.
   * @param log Request-scoped structured logger.
   * @returns Synthesized final text, reasoning trace, and all turn session messages.
   */
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
        const assistantMessage = MessageFactory.createAssistantText({
          userId: userMessage.userId,
          content,
          thought: response.thought,
        });
        sessionMessages.push(assistantMessage);
        return { finalText: content, thought: response.thought, sessionMessages };
      }

      // Handle tool calls step
      const toolCallMessage = MessageFactory.createAssistantToolCall({
        userId: userMessage.userId,
        toolCalls: response.toolCalls,
        thought: response.thought,
      });
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

  /**
   * Concurrently executes multiple tool calls requested by the model.
   * Isolates failures and returns structured ToolResultMessage entities for model feedback.
   */
  private async executeToolsConcurrently(
    userId: string,
    toolCalls: ToolCallRequest[],
    log: LoggerPort
  ): Promise<ToolResultMessage[]> {
    return Promise.all(
      toolCalls.map(async (tc): Promise<ToolResultMessage> => {
        if (tc.type === 'malformed') {
          log.warn('Tool call arguments were malformed', undefined, {
            toolName: tc.name,
            parseError: tc.parseError,
          });
          return MessageFactory.createToolResult({
            userId,
            toolCallId: tc.id,
            name: tc.name,
            content: `Error executing tool '${tc.name}': Failed to parse tool arguments: ${tc.parseError}`,
          });
        }

        try {
          log.info('Executing tool call', { toolName: tc.name });
          const result = await this.registry.executeTool(tc.name, tc.arguments);
          return MessageFactory.createToolResult({
            userId,
            toolCallId: tc.id,
            name: tc.name,
            content: result,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          log.warn('Tool execution failed', error, { toolName: tc.name });
          return MessageFactory.createToolResult({
            userId,
            toolCallId: tc.id,
            name: tc.name,
            content: `Error executing tool '${tc.name}': ${errorMessage}`,
          });
        }
      })
    );
  }

  /**
   * Handles the circuit breaker condition when max tool iterations is reached.
   * Forces the model to synthesize a final natural language answer without further tool calls.
   */
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

    const assistantMessage = MessageFactory.createAssistantText({
      userId,
      content,
      thought: forcedResponse.thought,
    });
    sessionMessages.push(assistantMessage);

    return { finalText: content, thought: forcedResponse.thought, sessionMessages };
  }
}
