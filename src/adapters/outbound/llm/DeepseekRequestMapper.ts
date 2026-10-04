import OpenAI from 'openai';
import {
  Message,
  UserMessage,
  AssistantMessage,
  AssistantTextMessage,
  AssistantToolCallMessage,
  ToolResultMessage,
} from '../../../core/entities/Message';

export type DeepseekAssistantMessageParam = OpenAI.Chat.ChatCompletionAssistantMessageParam & {
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
      return mapUserMessage(msg);
    case 'assistant':
      return mapAssistantMessage(msg);
    case 'tool':
      return mapToolResultMessage(msg);
    default:
      return assertNever(msg);
  }
}

/**
 * Maps a UserMessage entity to an OpenAI user message parameter.
 */
function mapUserMessage(msg: UserMessage): OpenAI.Chat.ChatCompletionUserMessageParam {
  return {
    role: 'user',
    content: msg.content,
  };
}

/**
 * Dispatches an AssistantMessage to either text or tool-call mapping based on the presence of toolCalls.
 */
function mapAssistantMessage(msg: AssistantMessage): DeepseekAssistantMessageParam {
  if (msg.toolCalls !== undefined) {
    return mapAssistantToolCallMessage(msg);
  }
  return mapAssistantTextMessage(msg);
}

/**
 * Maps an AssistantTextMessage entity to an OpenAI/DeepSeek assistant message parameter.
 */
function mapAssistantTextMessage(
  msg: AssistantTextMessage
): DeepseekAssistantMessageParam {
  const assistantMsg: DeepseekAssistantMessageParam = {
    role: 'assistant',
    content: msg.content,
  };

  if (typeof msg.reasoning === 'string') {
    assistantMsg.reasoning_content = msg.reasoning;
  }

  return assistantMsg;
}

/**
 * Maps an AssistantToolCallMessage entity to an OpenAI/DeepSeek assistant message parameter,
 * formatting tool calls and preserving chain-of-thought reasoning in `reasoning_content`
 * as required by the DeepSeek API.
 */
function mapAssistantToolCallMessage(
  msg: AssistantToolCallMessage
): DeepseekAssistantMessageParam {
  const hasContent = typeof msg.content === 'string' && msg.content.trim() !== '';
  const assistantMsg: DeepseekAssistantMessageParam = {
    role: 'assistant',
    content: hasContent ? msg.content : null,
    tool_calls: msg.toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.name,
        arguments: tc.type === 'valid' ? JSON.stringify(tc.arguments) : tc.rawArguments,
      },
    })),
  };

  if (typeof msg.reasoning === 'string') {
    assistantMsg.reasoning_content = msg.reasoning;
  }

  return assistantMsg;
}

/**
 * Maps a ToolResultMessage entity to an OpenAI tool message parameter.
 */
function mapToolResultMessage(msg: ToolResultMessage): OpenAI.Chat.ChatCompletionToolMessageParam {
  return {
    role: 'tool',
    tool_call_id: msg.toolCallId,
    content: msg.content,
  };
}

/**
 * Pure assertion helper for compile-time exhaustiveness checks.
 *
 * @throws Error if invoked at runtime with an unhandled discriminated union variant.
 */
function assertNever(x: never): never {
  throw new Error(`Unhandled message: ${JSON.stringify(x)}`);
}
