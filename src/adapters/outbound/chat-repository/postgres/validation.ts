import { DialogueTurn } from '../../../../core/entities/DialogueTurn';

/**
 * Validates dialogue turn structural and temporal invariants.
 */
export function assertValidDialogueTurn(turn: DialogueTurn): void {
  const msgs = turn.messages;
  if (!Array.isArray(msgs) || msgs.length < 2) {
    throw new Error(`Invalid turn: expected at least 2 messages, got ${msgs?.length ?? 0}`);
  }

  const first = msgs[0];
  if (first.role !== 'user') {
    throw new Error(`Invalid turn: first message must be UserMessage, got role '${first.role}'`);
  }

  const last = msgs[msgs.length - 1];
  if (last.role !== 'assistant' || ('toolCalls' in last && last.toolCalls !== undefined)) {
    throw new Error(
      `Invalid turn: final message must be AssistantTextMessage, got ${
        last.role === 'assistant' ? 'AssistantToolCallMessage' : `role '${last.role}'`
      }`
    );
  }

  if (turn.completedAt.getTime() < turn.startedAt.getTime()) {
    throw new Error(
      `Invalid turn: completedAt cannot precede startedAt (${turn.completedAt.toISOString()} < ${turn.startedAt.toISOString()})`
    );
  }
}
