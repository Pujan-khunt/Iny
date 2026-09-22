export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface BaseMessage {
  id: string;
  userId: string;
  timestamp: Date;
}

export interface UserMessage extends BaseMessage {
  role: 'user';
  content: string;
}

export interface AssistantTextMessage extends BaseMessage {
  role: 'assistant';
  content: string;
  thought?: string;
  toolCalls?: never;
}

export interface AssistantToolCallMessage extends BaseMessage {
  role: 'assistant';
  content?: string;
  thought?: string;
  toolCalls: ToolCall[];
}

export type AssistantMessage = AssistantTextMessage | AssistantToolCallMessage;

export interface ToolMessage extends BaseMessage {
  role: 'tool';
  toolCallId: string;
  name: string;
  content: string;
}

export type Message = UserMessage | AssistantMessage | ToolMessage;
