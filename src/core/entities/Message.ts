import { ToolCallRequest } from './ToolCallRequest';

/**
 * Common identity fields shared by all message types in the system.
 */
export interface BaseMessage {
  /** Unique identifier for the message. */
  id: string;
  /** Identifier of the user this message belongs to. */
  userId: string;
  /** Timestamp when the message was created. */
  timestamp: Date;
}

/**
 * An inbound message sent by the user. Always starts a DialogueTurn.
 */
export interface UserMessage extends BaseMessage {
  role: 'user';
  content: string;
}

/**
 * A final natural language response from the assistant delivered to the user.
 * Always concludes a DialogueTurn.
 */
export interface AssistantTextMessage extends BaseMessage {
  role: 'assistant';
  content: string;
  thought?: string;
  toolCalls?: never;
}

/**
 * An intermediate assistant response requesting one or more tool calls.
 * Never delivered to the user. Must be followed by ToolResultMessage results.
 */
export interface AssistantToolCallMessage extends BaseMessage {
  role: 'assistant';
  content?: string;
  thought?: string;
  toolCalls: ToolCallRequest[];
}

export type AssistantMessage = AssistantTextMessage | AssistantToolCallMessage;

/**
 * The output of a tool execution fed back into the model context.
 */
export interface ToolResultMessage extends BaseMessage {
  role: 'tool';
  /** Links this execution result to the originating ToolCallRequest id. */
  toolCallId: string;
  /** The name of the tool that was executed. */
  name: string;
  /** The stringified result or error message. */
  content: string;
}

/**
 * Top-level discriminated union for all conversation messages.
 * Discriminant is the "role" property ('user' | 'assistant' | 'tool').
 */
export type Message = UserMessage | AssistantMessage | ToolResultMessage;

/**
 * Parameters for creating a UserMessage entity.
 */
export interface CreateUserMessageParams {
  userId: string;
  content: string;
  id?: string;
  timestamp?: Date;
}

/**
 * Parameters for creating an AssistantTextMessage entity.
 */
export interface CreateAssistantTextMessageParams {
  userId: string;
  content: string;
  thought?: string;
  id?: string;
  timestamp?: Date;
}

/**
 * Parameters for creating an AssistantToolCallMessage entity.
 */
export interface CreateAssistantToolCallMessageParams {
  userId: string;
  toolCalls: ToolCallRequest[];
  thought?: string;
  id?: string;
  timestamp?: Date;
}

/**
 * Parameters for creating a ToolResultMessage entity.
 */
export interface CreateToolResultMessageParams {
  userId: string;
  toolCallId: string;
  name: string;
  content: string;
  id?: string;
  timestamp?: Date;
}

/**
 * Factory for creating strongly-typed Message domain entities with defaulted IDs and timestamps.
 */
export class MessageFactory {
  private constructor() {}

  static createUser(params: CreateUserMessageParams): UserMessage {
    return {
      id: params.id ?? crypto.randomUUID(),
      userId: params.userId,
      role: 'user',
      content: params.content,
      timestamp: params.timestamp ?? new Date(),
    };
  }

  static createAssistantText(params: CreateAssistantTextMessageParams): AssistantTextMessage {
    return {
      id: params.id ?? crypto.randomUUID(),
      userId: params.userId,
      role: 'assistant',
      content: params.content,
      thought: params.thought,
      timestamp: params.timestamp ?? new Date(),
    };
  }

  static createAssistantToolCall(
    params: CreateAssistantToolCallMessageParams
  ): AssistantToolCallMessage {
    return {
      id: params.id ?? crypto.randomUUID(),
      userId: params.userId,
      role: 'assistant',
      toolCalls: params.toolCalls,
      thought: params.thought,
      timestamp: params.timestamp ?? new Date(),
    };
  }

  static createToolResult(params: CreateToolResultMessageParams): ToolResultMessage {
    return {
      id: params.id ?? crypto.randomUUID(),
      userId: params.userId,
      role: 'tool',
      toolCallId: params.toolCallId,
      name: params.name,
      content: params.content,
      timestamp: params.timestamp ?? new Date(),
    };
  }
}

