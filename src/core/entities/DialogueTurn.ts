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
  /** Timestamp when the turn was completed and persisted. */
  createdAt: Date;
}
