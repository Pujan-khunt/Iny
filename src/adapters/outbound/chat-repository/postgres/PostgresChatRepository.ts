import { eq, desc } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { ChatRepositoryPort } from '../../../../core/ports/ChatRepositoryPort';
import { DialogueTurn } from '../../../../core/entities/DialogueTurn';
import { Message } from '../../../../core/entities/Message';
import { LoggerPort } from '../../../../core/ports/LoggerPort';
import { dialogueTurns, DialogueTurnRow } from './schema';
import { assertValidDialogueTurn } from './validation';
import { extractTurnMetadata } from './metadata';

/**
 * Outbound adapter implementing ChatRepositoryPort backed by PostgreSQL and Drizzle ORM.
 * Persists dialogue turns under the Hybrid Envelope pattern with relational metadata extraction
 * and enforces domain invariants at both the adapter and database levels.
 */
export class PostgresChatRepository implements ChatRepositoryPort {
  /**
   * @param db Drizzle PostgreSQL database client.
   * @param logger Leveled structured logger port.
   */
  constructor(
    private db: PgDatabase<any, any, any>,
    private logger: LoggerPort
  ) { }

  /**
   * Retrieves the most recent completed dialogue turns for a user, ordered chronologically
   * from oldest to newest. Rehydrates JSON message ISO timestamps back into Date objects.
   *
   * @param userId Unique identifier of the user.
   * @param maxTurns Maximum number of recent dialogue turns to retrieve (returns empty array if <= 0).
   * @returns Array of completed dialogue turns ordered chronologically.
   */
  async getRecentTurns(userId: string, maxTurns: number): Promise<DialogueTurn[]> {
    if (maxTurns <= 0) {
      return [];
    }

    try {
      const rows = (await this.db
        .select()
        .from(dialogueTurns)
        .where(eq(dialogueTurns.userId, userId))
        .orderBy(desc(dialogueTurns.completedAt))
        .limit(maxTurns)) as DialogueTurnRow[];

      const turns: DialogueTurn[] = rows.map((row: DialogueTurnRow) => ({
        id: row.id,
        userId: row.userId,
        messages: row.messages.map((m: Message) => ({
          ...m,
          ...(m.timestamp ? { timestamp: new Date(m.timestamp) } : {}),
        })),
        startedAt: new Date(row.startedAt),
        completedAt: new Date(row.completedAt),
      }));

      return turns.reverse();
    } catch (err) {
      this.logger.error('Failed to retrieve dialogue turns from PostgreSQL', err, {
        userId,
        maxTurns,
      });
      throw err;
    }
  }

  /**
   * Atomically persists a completed dialogue turn into PostgreSQL.
   * Validates structural and temporal invariants before saving and extracts relational
   * query columns (userQuery, assistantResponse, toolNames, reasoning).
   *
   * @param turn Completed dialogue turn entity satisfying domain invariants.
   * @throws Error if turn invariants are violated or the database insertion fails.
   */
  async saveTurn(turn: DialogueTurn): Promise<void> {
    assertValidDialogueTurn(turn);
    const { userQuery, assistantResponse, toolNames, reasoning } = extractTurnMetadata(turn);

    try {
      await this.db.insert(dialogueTurns).values({
        id: turn.id,
        userId: turn.userId,
        userQuery,
        assistantResponse,
        toolNames,
        reasoning,
        startedAt: turn.startedAt,
        completedAt: turn.completedAt,
        messages: turn.messages,
      });

      this.logger.debug('Saved dialogue turn to PostgreSQL', {
        turnId: turn.id,
        userId: turn.userId,
      });
    } catch (err) {
      this.logger.error('Failed to save dialogue turn to PostgreSQL', err, {
        turnId: turn.id,
        userId: turn.userId,
      });
      throw err;
    }
  }

  /**
   * Deletes all dialogue turns for a specific user from PostgreSQL.
   *
   * @param userId Unique identifier of the user whose history is to be purged.
   */
  async clearHistory(userId: string): Promise<void> {
    try {
      await this.db.delete(dialogueTurns).where(eq(dialogueTurns.userId, userId));
      this.logger.info('Cleared user dialogue history in PostgreSQL', { userId });
    } catch (err) {
      this.logger.error('Failed to clear dialogue history in PostgreSQL', err, { userId });
      throw err;
    }
  }
}
