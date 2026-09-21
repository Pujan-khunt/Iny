import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryChatRepository } from '../../../../src/adapters/outbound/chat-repository/InMemoryChatRepository';
import { DialogueTurn } from '../../../../src/core/entities/DialogueTurn';

describe('InMemoryChatRepository', () => {
  let repo: InMemoryChatRepository;

  beforeEach(() => {
    repo = new InMemoryChatRepository();
  });

  const createTurn = (id: string, userId: string, text: string): DialogueTurn => ({
    id,
    userId,
    messages: [
      { id: `u-${id}`, userId, role: 'user', content: text, timestamp: new Date() },
      { id: `a-${id}`, userId, role: 'assistant', content: `Echo: ${text}`, timestamp: new Date() }
    ],
    createdAt: new Date()
  });

  it('should return an empty array if no turns exist for a user', async () => {
    const turns = await repo.getRecentTurns('unknown-user', 5);
    expect(turns).toEqual([]);
  });

  it('should save and retrieve turns chronologically', async () => {
    const turn1 = createTurn('1', 'user-1', 'First');
    const turn2 = createTurn('2', 'user-1', 'Second');

    await repo.saveTurn(turn1);
    await repo.saveTurn(turn2);

    const turns = await repo.getRecentTurns('user-1', 5);
    expect(turns).toHaveLength(2);
    expect(turns[0].id).toBe('1');
    expect(turns[1].id).toBe('2');
  });

  it('should slice to the most recent turns according to maxTurns', async () => {
    for (let i = 1; i <= 5; i++) {
      await repo.saveTurn(createTurn(i.toString(), 'user-1', `Message ${i}`));
    }

    const turns = await repo.getRecentTurns('user-1', 2);
    expect(turns).toHaveLength(2);
    expect(turns[0].id).toBe('4');
    expect(turns[1].id).toBe('5');
  });

  it('should isolate turns between different users', async () => {
    await repo.saveTurn(createTurn('1', 'user-A', 'Hello A'));
    await repo.saveTurn(createTurn('2', 'user-B', 'Hello B'));

    const turnsA = await repo.getRecentTurns('user-A', 5);
    const turnsB = await repo.getRecentTurns('user-B', 5);

    expect(turnsA).toHaveLength(1);
    expect(turnsA[0].userId).toBe('user-A');
    expect(turnsB).toHaveLength(1);
    expect(turnsB[0].userId).toBe('user-B');
  });

  it('should clear history for a specific user', async () => {
    await repo.saveTurn(createTurn('1', 'user-1', 'Message'));
    await repo.clearHistory('user-1');

    const turns = await repo.getRecentTurns('user-1', 5);
    expect(turns).toEqual([]);
  });

  it('should return empty array if maxTurns is zero or negative', async () => {
    await repo.saveTurn(createTurn('1', 'user-1', 'Message 1'));

    const turnsZero = await repo.getRecentTurns('user-1', 0);
    expect(turnsZero).toEqual([]);

    const turnsNeg = await repo.getRecentTurns('user-1', -1);
    expect(turnsNeg).toEqual([]);
  });

  it('should store turns immutably without mutating previously retrieved arrays', async () => {
    const turn1 = createTurn('1', 'user-1', 'Message 1');
    await repo.saveTurn(turn1);

    const turnsBefore = await repo.getRecentTurns('user-1', 10);
    expect(turnsBefore).toHaveLength(1);

    const turn2 = createTurn('2', 'user-1', 'Message 2');
    await repo.saveTurn(turn2);

    const turnsAfter = await repo.getRecentTurns('user-1', 10);
    expect(turnsAfter).toHaveLength(2);
    expect(turnsBefore).toHaveLength(1);
  });
});
