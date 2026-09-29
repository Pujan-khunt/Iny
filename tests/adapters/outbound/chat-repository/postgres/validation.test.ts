import { describe, it, expect } from 'vitest';
import { assertValidDialogueTurn } from '../../../../../src/adapters/outbound/chat-repository/postgres/validation';
import { DialogueTurn } from '../../../../../src/core/entities/DialogueTurn';

describe('assertValidDialogueTurn', () => {
  const validTurn: DialogueTurn = {
    id: 'turn-1',
    userId: '15551234567@s.whatsapp.net',
    startedAt: new Date('2026-09-29T10:00:00Z'),
    completedAt: new Date('2026-09-29T10:00:02Z'),
    messages: [
      { id: 'm1', userId: 'user1', role: 'user', content: 'What is 5+5?', timestamp: new Date() },
      { id: 'm2', role: 'assistant', type: 'text', content: 'It is 10.' },
    ],
  };

  it('should accept valid standard dialogue turns', () => {
    expect(() => assertValidDialogueTurn(validTurn)).not.toThrow();
  });

  it('should reject turns with fewer than 2 messages', () => {
    const invalid = { ...validTurn, messages: [validTurn.messages[0]] };
    expect(() => assertValidDialogueTurn(invalid)).toThrow('Invalid turn: expected at least 2 messages');
  });

  it('should reject turns whose first message is not a UserMessage', () => {
    const invalid: DialogueTurn = {
      ...validTurn,
      messages: [
        { id: 'm1', role: 'assistant', type: 'text', content: 'Hello' },
        { id: 'm2', role: 'assistant', type: 'text', content: 'World' },
      ],
    };
    expect(() => assertValidDialogueTurn(invalid)).toThrow('first message must be UserMessage');
  });

  it('should reject turns whose final message is not an AssistantTextMessage', () => {
    const invalid: DialogueTurn = {
      ...validTurn,
      messages: [
        validTurn.messages[0],
        { id: 'm2', role: 'tool', toolCallId: 't1', toolName: 'calc', result: '10' },
      ],
    };
    expect(() => assertValidDialogueTurn(invalid)).toThrow('final message must be AssistantTextMessage');
  });

  it('should reject turns where completedAt is earlier than startedAt', () => {
    const invalid: DialogueTurn = {
      ...validTurn,
      startedAt: new Date('2026-09-29T10:00:05Z'),
      completedAt: new Date('2026-09-29T10:00:01Z'),
    };
    expect(() => assertValidDialogueTurn(invalid)).toThrow('completedAt cannot precede startedAt');
  });
});
