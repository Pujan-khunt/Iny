import { ChatRepositoryPort } from '../../../core/ports/ChatRepositoryPort';
import { DialogueTurn } from '../../../core/entities/DialogueTurn';

export class InMemoryChatRepository implements ChatRepositoryPort {
  private turns = new Map<string, DialogueTurn[]>();

  async getRecentTurns(userId: string, maxTurns: number): Promise<DialogueTurn[]> {
    const userTurns = this.turns.get(userId) ?? [];
    if (maxTurns <= 0) return [];
    return userTurns.slice(-maxTurns);
  }

  async saveTurn(turn: DialogueTurn): Promise<void> {
    const userTurns = this.turns.get(turn.userId) ?? [];
    this.turns.set(turn.userId, [...userTurns, turn]);
  }

  async clearHistory(userId: string): Promise<void> {
    this.turns.delete(userId);
  }
}
