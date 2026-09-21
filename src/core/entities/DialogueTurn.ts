import { Message } from './Message';

export interface DialogueTurn {
  id: string;
  userId: string;
  messages: Message[];
  createdAt: Date;
}
