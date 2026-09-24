import { DialogueTurn } from '../entities/DialogueTurn';

/**
 * Outbound port for persisting and retrieving conversation history.
 * Operates strictly on turn-atomic DialogueTurn boundaries.
 */
export interface ChatRepositoryPort {
  /**
   * Retrieves the most recent completed dialogue turns for a user.
   * Returns turns ordered chronologically from oldest to newest.
   *
   * @param userId Unique identifier of the user.
   * @param maxTurns Maximum number of recent completed dialogue turns to retrieve.
   * @returns Array of completed dialogue turns ordered chronologically from oldest to newest.
   */
  getRecentTurns(userId: string, maxTurns: number): Promise<DialogueTurn[]>;

  /**
   * Atomically persists a completed dialogue turn.
   * Ensures all messages belonging to the turn are stored together indivisibly.
   *
   * @param turn Completed dialogue turn satisfying domain invariants.
   */
  saveTurn(turn: DialogueTurn): Promise<void>;

  /**
   * Clears all persisted dialogue turns for a specific user.
   *
   * @param userId Unique identifier of the user whose history should be erased.
   */
  clearHistory(userId: string): Promise<void>;
}
