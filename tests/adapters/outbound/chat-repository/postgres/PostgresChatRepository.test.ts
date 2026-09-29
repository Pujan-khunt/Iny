import { describe, it, expect, beforeEach, vi } from 'vitest';
import { newDb } from 'pg-mem';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PostgresChatRepository } from '../../../../../src/adapters/outbound/chat-repository/postgres/PostgresChatRepository';
import { DialogueTurn } from '../../../../../src/core/entities/DialogueTurn';
import { LoggerPort } from '../../../../../src/core/ports/LoggerPort';

describe('PostgresChatRepository', () => {
  let repository: PostgresChatRepository;
  let db: NodePgDatabase;
  const mockLogger: LoggerPort = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const memDb = newDb();
    memDb.public.none(`
      CREATE TABLE dialogue_turns (
        id UUID PRIMARY KEY,
        user_id VARCHAR(128) NOT NULL,
        user_query TEXT NOT NULL,
        assistant_response TEXT NOT NULL,
        tool_names TEXT[] NOT NULL DEFAULT '{}',
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ NOT NULL,
        duration_ms INTEGER,
        messages JSONB NOT NULL
      );
    `);

    const { Pool } = memDb.adapters.createPg();
    const pool = new Pool();
    const origQuery = pool.query.bind(pool);
    pool.query = async function (queryTextOrConfig: any, values: any, callback: any) {
      let isRowModeArray = false;
      if (typeof queryTextOrConfig === 'object' && queryTextOrConfig !== null) {
        if (queryTextOrConfig.rowMode === 'array') {
          isRowModeArray = true;
          delete queryTextOrConfig.rowMode;
        }
        delete queryTextOrConfig.types;
      }
      const result = await origQuery(queryTextOrConfig, values, callback);
      if (isRowModeArray && result && Array.isArray(result.rows)) {
        result.rows = result.rows.map((row: any) => Object.values(row));
      }
      return result;
    };

    db = drizzle(pool);
    repository = new PostgresChatRepository(db, mockLogger);
  });

  const createSampleTurn = (id: string, userId: string, dateStr: string): DialogueTurn => ({
    id,
    userId,
    startedAt: new Date(dateStr),
    completedAt: new Date(new Date(dateStr).getTime() + 1500),
    messages: [
      { id: `${id}-m1`, userId, role: 'user', content: `Query ${id}`, timestamp: new Date(dateStr) },
      { id: `${id}-m2`, userId, role: 'assistant', content: `Answer ${id}`, timestamp: new Date(new Date(dateStr).getTime() + 1000) },
    ],
  });

  it('should save turn and retrieve recent turns in chronological order (oldest to newest)', async () => {
    const turn1 = createSampleTurn('00000000-0000-0000-0000-000000000001', 'user1', '2026-09-29T10:00:00Z');
    const turn2 = createSampleTurn('00000000-0000-0000-0000-000000000002', 'user1', '2026-09-29T10:05:00Z');
    const turn3 = createSampleTurn('00000000-0000-0000-0000-000000000003', 'user1', '2026-09-29T10:10:00Z');

    await repository.saveTurn(turn1);
    await repository.saveTurn(turn2);
    await repository.saveTurn(turn3);

    const recent = await repository.getRecentTurns('user1', 2);
    expect(recent).toHaveLength(2);
    expect(recent[0].id).toBe(turn2.id);
    expect(recent[1].id).toBe(turn3.id);
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Saved dialogue turn to PostgreSQL',
      expect.objectContaining({ turnId: turn1.id, userId: 'user1' })
    );
  });

  it('should return an empty array if maxTurns is 0 or negative', async () => {
    const turn = createSampleTurn('00000000-0000-0000-0000-000000000001', 'user1', '2026-09-29T10:00:00Z');
    await repository.saveTurn(turn);

    expect(await repository.getRecentTurns('user1', 0)).toEqual([]);
    expect(await repository.getRecentTurns('user1', -5)).toEqual([]);
  });

  it('should isolate dialogue turns between different users', async () => {
    const turnA = createSampleTurn('00000000-0000-0000-0000-000000000001', 'userA', '2026-09-29T10:00:00Z');
    const turnB = createSampleTurn('00000000-0000-0000-0000-000000000002', 'userB', '2026-09-29T10:05:00Z');

    await repository.saveTurn(turnA);
    await repository.saveTurn(turnB);

    const userATurns = await repository.getRecentTurns('userA', 10);
    expect(userATurns).toHaveLength(1);
    expect(userATurns[0].userId).toBe('userA');

    const userBTurns = await repository.getRecentTurns('userB', 10);
    expect(userBTurns).toHaveLength(1);
    expect(userBTurns[0].userId).toBe('userB');
  });

  it('should clear history for a specific user without affecting other users', async () => {
    const turnA = createSampleTurn('00000000-0000-0000-0000-000000000001', 'userA', '2026-09-29T10:00:00Z');
    const turnB = createSampleTurn('00000000-0000-0000-0000-000000000002', 'userB', '2026-09-29T10:05:00Z');

    await repository.saveTurn(turnA);
    await repository.saveTurn(turnB);

    await repository.clearHistory('userA');

    expect(await repository.getRecentTurns('userA', 10)).toHaveLength(0);
    expect(await repository.getRecentTurns('userB', 10)).toHaveLength(1);
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Cleared user dialogue history in PostgreSQL',
      { userId: 'userA' }
    );
  });

  it('should reject invalid turns before writing to database', async () => {
    const badTurn: any = {
      id: '00000000-0000-0000-0000-000000000001',
      userId: 'user1',
      startedAt: new Date(),
      completedAt: new Date(),
      messages: [{ id: 'bad-m1', userId: 'user1', role: 'assistant', content: 'orphaned', timestamp: new Date() }],
    };

    await expect(repository.saveTurn(badTurn)).rejects.toThrow('Invalid turn');
  });

  it('should save and retrieve turns with tool calls and revive dates', async () => {
    const turnWithTools: DialogueTurn = {
      id: '00000000-0000-0000-0000-000000000010',
      userId: 'user-tools',
      startedAt: new Date('2026-09-29T11:00:00Z'),
      completedAt: new Date('2026-09-29T11:00:05Z'),
      messages: [
        { id: 'm1', userId: 'user-tools', role: 'user', content: 'Calculate 2+2', timestamp: new Date('2026-09-29T11:00:00Z') },
        {
          id: 'm2',
          userId: 'user-tools',
          role: 'assistant',
          toolCalls: [{ type: 'valid', id: 'c1', name: 'calc', arguments: { expr: '2+2' } }],
          timestamp: new Date('2026-09-29T11:00:01Z'),
        },
        { id: 'm3', userId: 'user-tools', role: 'tool', toolCallId: 'c1', name: 'calc', content: '4', timestamp: new Date('2026-09-29T11:00:02Z') },
        { id: 'm4', userId: 'user-tools', role: 'assistant', content: 'The result is 4.', timestamp: new Date('2026-09-29T11:00:03Z') },
      ],
    };

    await repository.saveTurn(turnWithTools);
    const retrieved = await repository.getRecentTurns('user-tools', 5);
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].id).toBe(turnWithTools.id);
    expect(retrieved[0].startedAt).toEqual(turnWithTools.startedAt);
    expect(retrieved[0].completedAt).toEqual(turnWithTools.completedAt);
    expect(retrieved[0].messages).toHaveLength(4);
  });

  it('should log error and rethrow when saveTurn fails on database error', async () => {
    const errorDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockRejectedValue(new Error('DB insert failure')),
      }),
    };
    const failRepo = new PostgresChatRepository(errorDb as any, mockLogger);
    const turn = createSampleTurn('00000000-0000-0000-0000-000000000001', 'user1', '2026-09-29T10:00:00Z');

    await expect(failRepo.saveTurn(turn)).rejects.toThrow('DB insert failure');
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to save dialogue turn to PostgreSQL',
      expect.any(Error),
      { turnId: turn.id, userId: 'user1' }
    );
  });

  it('should log error and rethrow when getRecentTurns fails on database error', async () => {
    const errorDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockRejectedValue(new Error('DB select failure')),
            }),
          }),
        }),
      }),
    };
    const failRepo = new PostgresChatRepository(errorDb as any, mockLogger);

    await expect(failRepo.getRecentTurns('user1', 5)).rejects.toThrow('DB select failure');
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to retrieve dialogue turns from PostgreSQL',
      expect.any(Error),
      { userId: 'user1', maxTurns: 5 }
    );
  });

  it('should log error and rethrow when clearHistory fails on database error', async () => {
    const errorDb = {
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error('DB delete failure')),
      }),
    };
    const failRepo = new PostgresChatRepository(errorDb as any, mockLogger);

    await expect(failRepo.clearHistory('user1')).rejects.toThrow('DB delete failure');
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to clear dialogue history in PostgreSQL',
      expect.any(Error),
      { userId: 'user1' }
    );
  });
});
