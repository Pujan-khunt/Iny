import OpenAI from 'openai';
import { LLMResponse } from '../../../core/ports/LLMPort';
import { LLMResponseError } from '../../../core/errors/LLMErrors';
import { LoggerPort } from '../../../core/ports/LoggerPort';
import { parseToolCalls, FunctionToolCall } from './DeepseekToolCallParser';

type DeepseekChatCompletionMessage = OpenAI.Chat.ChatCompletionMessage & {
  reasoning_content?: string | null;
};

/**
 * Parses an OpenAI ChatCompletion payload into a domain LLMResponse.
 *
 * @param response Raw OpenAI ChatCompletion response.
 * @param logger Optional logger for recording response details.
 * @returns Parsed domain LLMResponse (either tool_calls or text).
 * @throws LLMResponseError if the response contains no choices or message.
 */
export function parseOpenAIResponse(
  response: OpenAI.Chat.ChatCompletion,
  logger?: LoggerPort
): LLMResponse {
  const choice = response.choices?.[0];
  const responseMessage = choice?.message as DeepseekChatCompletionMessage | undefined;

  if (!choice || !responseMessage) {
    throw new LLMResponseError('No message returned from LLM provider');
  }

  const reasoning = responseMessage.reasoning_content || undefined;
  const functionCalls =
    responseMessage.tool_calls?.filter(
      (tc): tc is FunctionToolCall => tc.type === 'function'
    ) ?? [];

  if (functionCalls.length > 0) {
    const content = responseMessage.content || undefined;
    const toolCalls = parseToolCalls(functionCalls);

    logger?.debug('Received response from Deepseek LLM', {
      hasToolCall: true,
      toolCallCount: toolCalls.length,
      hasReasoning: Boolean(reasoning),
      hasContent: Boolean(content),
    });

    return {
      type: 'tool_calls',
      toolCalls,
      content,
      reasoning,
    };
  }

  const content = responseMessage.content ?? '';

  logger?.debug('Received response from Deepseek LLM', {
    hasToolCall: false,
    hasReasoning: Boolean(reasoning),
  });

  return {
    type: 'text',
    content,
    reasoning,
  };
}
