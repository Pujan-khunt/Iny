import { eq, desc } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { ChatRepositoryPort } from '../../../../core/ports/ChatRepositoryPort';
import { DialogueTurn } from '../../../../core/entities/DialogueTurn';
import { LoggerPort } from '../../../../core/ports/LoggerPort';
import { dialogueTurns } from './schema';
import { assertValidDialogueTurn } from './validation';
import { extractTurnMetadata } from './metadata';

export class PostgresChatRepository implements ChatRepositoryPort {
  constructor(
    private db: PgDatabase<any, any, any>,
    private logger: LoggerPort
  ) {}

  async getRecentTurns(userId: string, maxTurns: number): Promise<DialogueTurn[]> {
    if (maxTurns <= 0) {
      return [];
    }

    try {
      const rows = await this.db
        .select()
        .from(dialogueTurns)
        .where(eq(dialogueTurns.userId, userId))
        .orderBy(desc(dialogueTurns.completedAt))
        .limit(maxTurns);

      const turns: DialogueTurn[] = rows.map((row: any) => ({
        id: row.id,
        userId: row.userId,
        messages: Array.isArray(row.messages)
          ? row.messages.map((m: any) => ({
              ...m,
              ...(m.timestamp ? { timestamp: new Date(m.timestamp) } : {}),
            }))
          : row.messages,
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

  async saveTurn(turn: DialogueTurn): Promise<void> {
    assertValidDialogueTurn(turn);
    const { userQuery, assistantResponse, toolNames } = extractTurnMetadata(turn);

    try {
      await this.db.insert(dialogueTurns).values({
        id: turn.id,
        userId: turn.userId,
        userQuery,
        assistantResponse,
        toolNames,
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
