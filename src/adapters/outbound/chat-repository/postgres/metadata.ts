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
  const first = turn.messages[0] as UserMessage;
  const last = turn.messages[turn.messages.length - 1] as AssistantTextMessage;

  const toolNamesSet = new Set<string>();
  for (const msg of turn.messages) {
    const m = msg as any;
    if (m.role === 'assistant' && m.type === 'tool_calls' && Array.isArray(m.toolCalls)) {
      for (const call of m.toolCalls) {
        toolNamesSet.add(call.name);
      }
    }
  }

  return {
    userQuery: first.content || '',
    assistantResponse: last.content || '',
    toolNames: Array.from(toolNamesSet),
  };
}
