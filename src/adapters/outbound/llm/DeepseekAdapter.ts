import OpenAI from 'openai';
import { LLMPort, LLMResponse, GenerateResponseOptions } from '../../../core/ports/LLMPort';
import { Message, ToolCall } from '../../../core/entities/Message';
import { Plugin } from '../../../core/ports/PluginRegistryPort';
import { LoggerPort } from '../../../core/ports/LoggerPort';
import {
  LLMError,
  LLMAuthenticationError,
  LLMInsufficientBalanceError,
  LLMInvalidRequestError,
  LLMRateLimitError,
  LLMServerError,
  LLMServerOverloadedError,
  LLMResponseError,
} from '../../../core/errors/LLMErrors';

type FunctionToolCall = Extract<OpenAI.Chat.ChatCompletionMessageToolCall, { type: 'function' }>;

export interface DeepseekAdapterOptions {
  baseURL?: string;
  model?: string;
  logger?: LoggerPort;
}

export class DeepseekAdapter implements LLMPort {
  private client: OpenAI;
  private baseURL: string;
  private model: string;
  private logger?: LoggerPort;

  constructor(apiKey: string, logger?: LoggerPort, options?: { baseURL?: string; model?: string });
  constructor(apiKey: string, options?: DeepseekAdapterOptions);
  constructor(
    apiKey: string,
    loggerOrOptions?: LoggerPort | DeepseekAdapterOptions,
    maybeOptions?: { baseURL?: string; model?: string }
  ) {
    let logger: LoggerPort | undefined;
    let baseURL: string | undefined;
    let model: string | undefined;

    if (loggerOrOptions && typeof (loggerOrOptions as LoggerPort).info === 'function') {
      logger = loggerOrOptions as LoggerPort;
      baseURL = maybeOptions?.baseURL;
      model = maybeOptions?.model;
    } else if (loggerOrOptions && typeof loggerOrOptions === 'object') {
      const opts = loggerOrOptions as DeepseekAdapterOptions;
      logger = opts.logger;
      baseURL = opts.baseURL;
      model = opts.model;
    }

    this.logger = logger;
    this.baseURL = baseURL ?? 'https://api.deepseek.com';
    this.model = model ?? 'deepseek-flash';

    this.client = new OpenAI({
      apiKey,
      baseURL: this.baseURL,
    });
  }

  async generateResponse(
    systemPrompt: string,
    history: Message[],
    plugins: Plugin[],
    options?: GenerateResponseOptions
  ): Promise<LLMResponse> {
    const messages = this.buildMessagesPayload(systemPrompt, history);
    const tools = this.buildToolsPayload(plugins, options?.forcedSynthesis);

    this.logger?.debug('Sending request to Deepseek LLM', {
      model: this.model,
      messageCount: messages.length,
    });

    const response = await this.executeChatCompletion(messages, tools);
    return this.parseResponse(response);
  }

  private buildMessagesPayload(
    systemPrompt: string,
    history: Message[]
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    return [
      { role: 'system', content: systemPrompt },
      ...history.map((msg) => this.mapDomainMessageToOpenAI(msg)),
    ];
  }

  private mapDomainMessageToOpenAI(msg: Message): OpenAI.Chat.ChatCompletionMessageParam {
    switch (msg.role) {
      case 'user':
        return {
          role: 'user',
          content: msg.content,
        };
      case 'assistant': {
        const hasContent = typeof msg.content === 'string' && msg.content.trim() !== '';
        const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: hasContent ? msg.content! : (msg.toolCalls?.length ? null : ''),
        };
        if (msg.thought) {
          (assistantMsg as any).reasoning_content = msg.thought;
        }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          assistantMsg.tool_calls = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }
        return assistantMsg;
      }
      case 'tool':
        return {
          role: 'tool',
          tool_call_id: msg.toolCallId,
          content: msg.content,
        };
      default: {
        const exhaustiveCheck: never = msg;
        throw new Error(`Unhandled message role: ${(exhaustiveCheck as any).role}`);
      }
    }
  }

  private buildToolsPayload(
    plugins: Plugin[],
    forcedSynthesis?: boolean
  ): OpenAI.Chat.ChatCompletionTool[] | undefined {
    if (forcedSynthesis || plugins.length === 0) {
      return undefined;
    }

    return plugins.map((p) => ({
      type: 'function' as const,
      function: {
        name: p.name,
        description: p.description,
        parameters: p.schema,
      },
    }));
  }

  private async executeChatCompletion(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    tools: OpenAI.Chat.ChatCompletionTool[] | undefined
  ): Promise<OpenAI.Chat.ChatCompletion> {
    try {
      return await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools,
        tool_choice: tools ? 'auto' : undefined,
      });
    } catch (error: any) {
      this.translateAndThrowError(error);
    }
  }

  private translateAndThrowError(error: any): never {
    if (error instanceof LLMError) {
      throw error;
    }

    const status = error?.status;
    const code = error?.code;
    const message = error?.message || 'Error occurred while communicating with LLM provider';

    switch (status) {
      case 400:
      case 422:
        throw new LLMInvalidRequestError(message, { status, code, cause: error });
      case 401:
        throw new LLMAuthenticationError(message, { status, code, cause: error });
      case 402:
        throw new LLMInsufficientBalanceError(message, { status, code, cause: error });
      case 429:
        throw new LLMRateLimitError(message, { status, code, cause: error });
      case 500:
        throw new LLMServerError(message, { status, code, cause: error });
      case 503:
        throw new LLMServerOverloadedError(message, { status, code, cause: error });
      default:
        throw new LLMError(message, { status, code, cause: error });
    }
  }

  private parseResponse(response: OpenAI.Chat.ChatCompletion): LLMResponse {
    const choice = response.choices?.[0];
    const responseMessage = choice?.message;

    if (!choice || !responseMessage) {
      throw new LLMResponseError('No message returned from LLM provider');
    }

    const functionCalls = responseMessage.tool_calls?.filter((tc) => tc.type === 'function') ?? [];

    if (functionCalls.length > 0) {
      const thought =
        (responseMessage as any).reasoning_content || responseMessage.content || undefined;
      const toolCalls = this.parseToolCalls(functionCalls);

      this.logger?.debug('Received response from Deepseek LLM', {
        hasToolCall: true,
        toolCallCount: toolCalls.length,
      });

      return {
        type: 'tool_calls',
        toolCalls,
        thought,
      };
    }

    const thought = (responseMessage as any).reasoning_content || undefined;
    const content = responseMessage.content ?? '';

    this.logger?.debug('Received response from Deepseek LLM', {
      hasToolCall: false,
    });

    return {
      type: 'text',
      content,
      thought,
    };
  }

  private parseToolCalls(functionCalls: FunctionToolCall[]): ToolCall[] {
    return functionCalls.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: this.parseToolArguments(tc.function.arguments),
    }));
  }

  private parseToolArguments(rawArguments: string): Record<string, unknown> {
    try {
      const raw = JSON.parse(rawArguments);
      if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        return raw as Record<string, unknown>;
      }
      throw new Error('Tool arguments must be a JSON object');
    } catch (error) {
      if (this.logger) {
        this.logger.error('Failed to parse tool arguments', error);
      } else {
        console.error('Failed to parse tool arguments:', error);
      }
      return {};
    }
  }
}
