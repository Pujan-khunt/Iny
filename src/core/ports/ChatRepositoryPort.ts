import { DialogueTurn } from '../entities/DialogueTurn';

export interface ChatRepositoryPort {
  getRecentTurns(userId: string, maxTurns: number): Promise<DialogueTurn[]>;
  saveTurn(turn: DialogueTurn): Promise<void>;
  clearHistory(userId: string): Promise<void>;
}
