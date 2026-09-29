import { Message } from './Message';

/**
 * A complete, atomic exchange between a user and the assistant.
 * Pruned and retrieved as an indivisible unit to preserve context boundaries.
 */
export interface DialogueTurn {
  /** Unique identifier for the turn. */
  id: string;
  /** The user who participated in this dialogue exchange. */
  userId: string;
  /**
   * Ordered sequence of messages for this turn.
   * Invariant: [UserMessage, ...(AssistantToolCallMessage + ToolMessage[])*, AssistantTextMessage]
   */
  messages: Message[];
  /** Timestamp when Iny began processing the incoming user message. */
  startedAt: Date;
  /** Timestamp when the final assistant response was delivered to the user. */
  completedAt: Date;
}
