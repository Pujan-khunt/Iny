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
   * Invariant: [UserMessage, ...(AssistantToolCallMessage + ToolResultMessage[])*, AssistantTextMessage]
   */
  messages: Message[];
  /** Timestamp when Iny began processing the incoming user message. */
  startedAt: Date;
  /** Timestamp when the final assistant response was delivered to the user. */
  completedAt: Date;
}

/**
 * Parameters for creating a DialogueTurn entity.
 */
export interface CreateDialogueTurnParams {
  userId: string;
  messages: Message[];
  startedAt: Date;
  completedAt: Date;
  id?: string;
}

/**
 * Factory for creating strongly-typed DialogueTurn domain entities with defaulted IDs.
 */
export class DialogueTurnFactory {
  private constructor() {}

  static create(params: CreateDialogueTurnParams): DialogueTurn {
    return {
      id: params.id ?? crypto.randomUUID(),
      userId: params.userId,
      messages: params.messages,
      startedAt: params.startedAt,
      completedAt: params.completedAt,
    };
  }
}

