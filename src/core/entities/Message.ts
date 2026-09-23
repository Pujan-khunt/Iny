import { ToolCall } from './ToolCall';

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
 * Never delivered to the user. Must be followed by ToolMessage results.
 */
export interface AssistantToolCallMessage extends BaseMessage {
  role: 'assistant';
  content?: string;
  thought?: string;
  toolCalls: ToolCall[];
}

export type AssistantMessage = AssistantTextMessage | AssistantToolCallMessage;

/**
 * The output of a tool execution fed back into the model context.
 */
export interface ToolMessage extends BaseMessage {
  role: 'tool';
  /** Links this execution result to the originating ToolCall id. */
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
export type Message = UserMessage | AssistantMessage | ToolMessage;
