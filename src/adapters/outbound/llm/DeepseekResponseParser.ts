import OpenAI from 'openai';
import { LLMResponse } from '../../../core/ports/LLMPort';
import { ToolCall } from '../../../core/entities/ToolCall';
import { LLMResponseError } from '../../../core/errors/LLMErrors';
import { LoggerPort } from '../../../core/ports/LoggerPort';

type FunctionToolCall = Extract<OpenAI.Chat.ChatCompletionMessageToolCall, { type: 'function' }>;

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

  const functionCalls =
    responseMessage.tool_calls?.filter(
      (tc): tc is FunctionToolCall => tc.type === 'function'
    ) ?? [];

  if (functionCalls.length > 0) {
    const thought =
      responseMessage.reasoning_content || responseMessage.content || undefined;
    const toolCalls = parseToolCalls(functionCalls);

    logger?.debug('Received response from Deepseek LLM', {
      hasToolCall: true,
      toolCallCount: toolCalls.length,
    });

    return {
      type: 'tool_calls',
      toolCalls,
      thought,
    };
  }

  const thought = responseMessage.reasoning_content || undefined;
  const content = responseMessage.content ?? '';

  logger?.debug('Received response from Deepseek LLM', {
    hasToolCall: false,
  });

  return {
    type: 'text',
    content,
    thought,
  };
}

/**
 * Parses an array of OpenAI function tool calls into domain ToolCall entities.
 * Tool arguments that fail JSON deserialization or are not JSON objects are mapped
 * to MalformedToolCall instead of throwing.
 *
 * @param functionCalls Function calls returned from OpenAI API.
 * @returns Array of parsed ToolCall entities (ValidToolCall or MalformedToolCall).
 */
function parseToolCalls(functionCalls: FunctionToolCall[]): ToolCall[] {
  return functionCalls.map((tc) => {
    const raw = tc.function.arguments;
    if (!raw || raw.trim() === '') {
      return {
        type: 'valid',
        id: tc.id,
        name: tc.function.name,
        arguments: {},
      };
    }
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return {
          type: 'valid',
          id: tc.id,
          name: tc.function.name,
          arguments: parsed as Record<string, unknown>,
        };
      }
      throw new Error('Tool arguments must be a JSON object');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        type: 'malformed',
        id: tc.id,
        name: tc.function.name,
        rawArguments: raw,
        parseError: errorMessage,
      };
    }
  });
}
