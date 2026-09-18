import OpenAI from 'openai';
import { LLMPort, LLMResponse } from '../../../core/ports/LLMPort';
import { Message } from '../../../core/entities/Message';
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
    newMessage: Message,
    plugins: Plugin[]
  ): Promise<LLMResponse> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((msg) => ({ role: 'user' as const, content: msg.content })),
      { role: 'user', content: newMessage.content },
    ];

    const tools =
      plugins.length > 0
        ? plugins.map((p) => ({
            type: 'function' as const,
            function: {
              name: p.name,
              description: p.description,
              parameters: p.schema,
            },
          }))
        : undefined;

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

    const responseMessage = response.choices?.[0]?.message;

    if (!responseMessage) {
      throw new LLMResponseError('No message returned from LLM provider');
    }

    this.logger?.debug('Received response from Deepseek LLM', {
      hasToolCall: Boolean(responseMessage.tool_calls && responseMessage.tool_calls.length > 0),
    });

    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      const toolCall = responseMessage.tool_calls[0];
      if (toolCall.type === 'function') {
        let parsedArgs: any;
        try {
          parsedArgs = JSON.parse(toolCall.function.arguments);
        } catch (error) {
          if (this.logger) {
            this.logger.error('Failed to parse tool arguments', error);
          } else {
            console.error('Failed to parse tool arguments:', error);
          }
          return { text: 'Sorry, I encountered an error while processing the tool arguments.' };
        }

        return {
          toolCall: {
            name: toolCall.function.name,
            arguments: parsedArgs,
          },
        };
      }
    }

    return { text: responseMessage.content || '' };
  }
}
