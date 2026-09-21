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

export class DeepseekAdapter implements LLMPort {
  private client: OpenAI;

  constructor(apiKey: string, private logger?: LoggerPort) {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com',
    });
  }

  async generateResponse(
    systemPrompt: string,
    history: Message[],
    plugins: Plugin[],
    options?: GenerateResponseOptions
  ): Promise<LLMResponse> {
    const mappedHistory: OpenAI.Chat.ChatCompletionMessageParam[] = history.map((msg) => {
      switch (msg.role) {
        case 'user':
          return {
            role: 'user',
            content: msg.content,
          };
        case 'assistant': {
          const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
            role: 'assistant',
            content: msg.content ?? null,
          };
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
    });

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...mappedHistory,
    ];

    const tools =
      options?.forcedSynthesis || plugins.length === 0
        ? undefined
        : plugins.map((p) => ({
            type: 'function' as const,
            function: {
              name: p.name,
              description: p.description,
              parameters: p.schema,
            },
          }));

    this.logger?.debug('Sending request to Deepseek LLM', {
      model: 'deepseek-flash',
      messageCount: messages.length,
    });

    let response: OpenAI.Chat.ChatCompletion;
    try {
      response = await this.client.chat.completions.create({
        model: 'deepseek-flash',
        messages,
        tools,
        tool_choice: tools ? 'auto' : undefined,
      });
    } catch (error: any) {
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

    const choice = response.choices?.[0];
    const responseMessage = choice?.message;

    if (!choice || !responseMessage) {
      throw new LLMResponseError('No message returned from LLM provider');
    }

    const functionCalls = responseMessage.tool_calls?.filter((tc) => tc.type === 'function') ?? [];

    if (functionCalls.length > 0) {
      const thought =
        (responseMessage as any).reasoning_content || responseMessage.content || undefined;

      const toolCalls: ToolCall[] = functionCalls.map((tc) => {
        let parsedArgs: Record<string, unknown> = {};
        try {
          const raw = JSON.parse(tc.function.arguments);
          if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
            parsedArgs = raw as Record<string, unknown>;
          } else {
            throw new Error('Tool arguments must be a JSON object');
          }
        } catch (error) {
          if (this.logger) {
            this.logger.error('Failed to parse tool arguments', error);
          } else {
            console.error('Failed to parse tool arguments:', error);
          }
          parsedArgs = {};
        }

        return {
          id: tc.id,
          name: tc.function.name,
          arguments: parsedArgs,
        };
      });

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
}
