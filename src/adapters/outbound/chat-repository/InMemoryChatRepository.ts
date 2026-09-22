import { ChatRepositoryPort } from '../../../core/ports/ChatRepositoryPort';
import { DialogueTurn } from '../../../core/entities/DialogueTurn';

export class InMemoryChatRepository implements ChatRepositoryPort {
  private turns = new Map<string, DialogueTurn[]>();
  private readonly maxRetainedTurns: number;

  constructor(maxRetainedTurns = 200) {
    this.maxRetainedTurns = maxRetainedTurns;
  }

  async getRecentTurns(userId: string, maxTurns: number): Promise<DialogueTurn[]> {
    const userTurns = this.turns.get(userId) ?? [];
    if (maxTurns <= 0) return [];
    return userTurns.slice(-maxTurns);
  }

  async saveTurn(turn: DialogueTurn): Promise<void> {
    const userTurns = this.turns.get(turn.userId) ?? [];
    const updated = [...userTurns, turn];
    if (updated.length > this.maxRetainedTurns) {
      updated.splice(0, updated.length - this.maxRetainedTurns);
    }
    this.turns.set(turn.userId, updated);
  }

  async clearHistory(userId: string): Promise<void> {
    this.turns.delete(userId);
  }
}
