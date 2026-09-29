import { DialogueTurn } from '../../../../core/entities/DialogueTurn';
import { UserMessage, AssistantTextMessage } from '../../../../core/entities/Message';

export interface TurnMetadata {
  userQuery: string;
  assistantResponse: string;
  toolNames: string[];
}

/**
 * Extracts first-class relational metadata from a domain DialogueTurn.
 */
export function extractTurnMetadata(turn: DialogueTurn): TurnMetadata {
  const first = turn.messages?.[0] as UserMessage | undefined;
  const last = turn.messages?.[turn.messages?.length - 1] as AssistantTextMessage | undefined;

  const toolNamesSet = new Set<string>();
  if (Array.isArray(turn.messages)) {
    for (const msg of turn.messages) {
      if (msg.role === 'assistant' && 'toolCalls' in msg && Array.isArray(msg.toolCalls)) {
        for (const call of msg.toolCalls) {
          if (call?.name) {
            toolNamesSet.add(call.name);
          }
        }
      }
    }
  }

  return {
    userQuery: first?.content || '',
    assistantResponse: last?.content || '',
    toolNames: Array.from(toolNamesSet),
  };
}
