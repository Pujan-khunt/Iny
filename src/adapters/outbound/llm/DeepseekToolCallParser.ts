import OpenAI from 'openai';
import { ToolCallRequest, ToolCallRequestFactory } from '../../../core/entities/ToolCallRequest';

export type FunctionToolCall = Extract<
  OpenAI.Chat.ChatCompletionMessageToolCall,
  { type: 'function' }
>;

/**
 * Parses an array of OpenAI function tool calls into domain ToolCallRequest entities.
 * Tool arguments that fail JSON deserialization or are not JSON objects are mapped
 * to MalformedToolCallRequest instead of throwing.
 *
 * @param functionCalls Function calls returned from OpenAI API.
 * @returns Array of parsed ToolCallRequest entities (ValidToolCallRequest or MalformedToolCallRequest).
 */
export function parseToolCalls(functionCalls: FunctionToolCall[]): ToolCallRequest[] {
  return functionCalls.map((tc) => {
    const raw = tc.function.arguments;
    if (!raw || raw.trim() === '') {
      return ToolCallRequestFactory.createValid({
        id: tc.id,
        name: tc.function.name,
        arguments: {},
      });
    }
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return ToolCallRequestFactory.createValid({
          id: tc.id,
          name: tc.function.name,
          arguments: parsed as Record<string, unknown>,
        });
      }
      throw new Error('Tool arguments must be a JSON object');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return ToolCallRequestFactory.createMalformed({
        id: tc.id,
        name: tc.function.name,
        rawArguments: raw,
        parseError: errorMessage,
      });
    }
  });
}
