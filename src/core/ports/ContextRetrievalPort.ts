import { Message } from '../entities/Message';

/**
 * Outbound port for retrieving contextual conversation history for a user.
 */
export interface ContextRetrievalPort {
  /**
   * Retrieves conversation context messages for a user.
   * Returns messages ordered chronologically from oldest to newest.
   *
   * @param userId Unique identifier of the user.
   * @returns Array of prior conversation messages to prepend to the agent loop prompt.
   */
  retrieveContext(userId: string): Promise<Message[]>;
}
