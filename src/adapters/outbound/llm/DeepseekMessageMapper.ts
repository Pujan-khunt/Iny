import OpenAI from 'openai';
import { Message } from '../../../core/entities/Message';
import { ToolDefinition } from '../../../core/ports/ToolRegistryPort';

type DeepseekAssistantMessageParam = OpenAI.Chat.ChatCompletionAssistantMessageParam & {
  reasoning_content?: string | null;
};

/**
 * Maps system prompt and domain messages into OpenAI ChatCompletion message parameters.
 *
 * @param systemPrompt The system prompt instructions for the model.
 * @param messages The chronological sequence of domain messages.
 * @returns Array of OpenAI ChatCompletion message parameters.
 */
export function mapDomainMessagesToOpenAI(
  systemPrompt: string,
  messages: Message[]
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return [
    { role: 'system', content: systemPrompt },
    ...messages.map((msg) => mapSingleMessage(msg)),
  ];
}

/**
 * Maps an individual domain message into an OpenAI ChatCompletion message parameter.
 *
 * @param msg The domain message to map.
 * @returns The corresponding OpenAI ChatCompletion message parameter.
 */
function mapSingleMessage(msg: Message): OpenAI.Chat.ChatCompletionMessageParam {
  switch (msg.role) {
    case 'user':
      return {
        role: 'user',
        content: msg.content,
      };
    case 'assistant': {
      const hasContent = typeof msg.content === 'string' && msg.content.trim() !== '';
      const assistantMsg: DeepseekAssistantMessageParam = {
        role: 'assistant',
        content: hasContent ? msg.content : (msg.toolCalls?.length ? null : ''),
      };
      if (msg.thought) {
        assistantMsg.reasoning_content = msg.thought;
      }
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        assistantMsg.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: tc.type === 'valid' ? JSON.stringify(tc.arguments) : tc.rawArguments,
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
    default:
      return assertNever(msg);
  }
}

/**
 * Pure assertion helper for compile-time exhaustiveness checks.
 *
 * @throws Error if invoked at runtime with an unhandled discriminated union variant.
 */
function assertNever(x: never): never {
  throw new Error(`Unhandled message: ${JSON.stringify(x)}`);
}

/**
 * Maps domain tool definitions into OpenAI ChatCompletion tools schema.
 *
 * @param tools Array of tool definitions to map.
 * @param forcedSynthesis When true, returns undefined to suppress tool calls.
 * @returns Array of OpenAI tools or undefined if empty or suppressed.
 */
export function mapToolDefinitionsToOpenAI(
  tools: ToolDefinition[],
  forcedSynthesis?: boolean
): OpenAI.Chat.ChatCompletionTool[] | undefined {
  if (forcedSynthesis || tools.length === 0) {
    return undefined;
  }
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.schema,
    },
  }));
}
