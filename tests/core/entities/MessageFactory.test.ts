import { describe, it, expect } from 'vitest';
import { MessageFactory } from '../../../src/core/entities/Message';
import { DialogueTurnFactory } from '../../../src/core/entities/DialogueTurn';

describe('MessageFactory', () => {
  it('should create a UserMessage with defaulted UUID and timestamp', () => {
    const msg = MessageFactory.createUser({
      userId: 'user-1',
      content: 'Hello world',
    });

    expect(msg.role).toBe('user');
    expect(msg.userId).toBe('user-1');
    expect(msg.content).toBe('Hello world');
    expect(msg.id).toBeDefined();
    expect(typeof msg.id).toBe('string');
    expect(msg.timestamp).toBeInstanceOf(Date);
  });

  it('should respect custom id and timestamp when creating UserMessage', () => {
    const customDate = new Date('2026-10-01T10:00:00Z');
    const msg = MessageFactory.createUser({
      userId: 'user-1',
      content: 'Custom time',
      id: 'custom-id-1',
      timestamp: customDate,
    });

    expect(msg.id).toBe('custom-id-1');
    expect(msg.timestamp).toBe(customDate);
  });

  it('should create an AssistantTextMessage with optional reasoning', () => {
    const msg = MessageFactory.createAssistantText({
      userId: 'user-1',
      content: 'Here is your answer',
      reasoning: 'Reasoning steps...',
    });

    expect(msg.role).toBe('assistant');
    expect(msg.userId).toBe('user-1');
    expect(msg.content).toBe('Here is your answer');
    expect(msg.reasoning).toBe('Reasoning steps...');
    expect(msg.id).toBeDefined();
    expect(msg.timestamp).toBeInstanceOf(Date);
  });

  it('should create an AssistantToolCallMessage with toolCalls and optional reasoning', () => {
    const msg = MessageFactory.createAssistantToolCall({
      userId: 'user-1',
      toolCalls: [
        {
          type: 'valid',
          id: 'call-1',
          name: 'calc',
          arguments: { expr: '2+2' },
        },
      ],
      reasoning: 'Need to compute',
    });

    expect(msg.role).toBe('assistant');
    expect(msg.userId).toBe('user-1');
    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls[0].name).toBe('calc');
    expect(msg.reasoning).toBe('Need to compute');
    expect(msg.content).toBeUndefined();
    expect(msg.id).toBeDefined();
    expect(msg.timestamp).toBeInstanceOf(Date);
  });

  it('should create an AssistantToolCallMessage with accompanying natural content', () => {
    const msg = MessageFactory.createAssistantToolCall({
      userId: 'user-1',
      toolCalls: [
        {
          type: 'valid',
          id: 'call-1',
          name: 'calc',
          arguments: { expr: '2+2' },
        },
      ],
      content: 'I will calculate that for you.',
      reasoning: 'Step 1',
    });

    expect(msg.role).toBe('assistant');
    expect(msg.content).toBe('I will calculate that for you.');
    expect(msg.reasoning).toBe('Step 1');
  });

  it('should create a ToolResultMessage with tool metadata and content', () => {
    const msg = MessageFactory.createToolResult({
      userId: 'user-1',
      toolCallId: 'call-1',
      name: 'calc',
      content: '4',
    });

    expect(msg.role).toBe('tool');
    expect(msg.userId).toBe('user-1');
    expect(msg.toolCallId).toBe('call-1');
    expect(msg.name).toBe('calc');
    expect(msg.content).toBe('4');
    expect(msg.id).toBeDefined();
    expect(msg.timestamp).toBeInstanceOf(Date);
  });
});

describe('DialogueTurnFactory', () => {
  it('should create a DialogueTurn with defaulted UUID and provided turn lifecycle data', () => {
    const userMsg = MessageFactory.createUser({
      userId: 'user-1',
      content: 'Hi',
    });
    const assistantMsg = MessageFactory.createAssistantText({
      userId: 'user-1',
      content: 'Hello',
    });

    const startedAt = new Date('2026-10-04T12:00:00Z');
    const completedAt = new Date('2026-10-04T12:00:01Z');

    const turn = DialogueTurnFactory.create({
      userId: 'user-1',
      messages: [userMsg, assistantMsg],
      startedAt,
      completedAt,
    });

    expect(turn.id).toBeDefined();
    expect(typeof turn.id).toBe('string');
    expect(turn.userId).toBe('user-1');
    expect(turn.messages).toEqual([userMsg, assistantMsg]);
    expect(turn.startedAt).toBe(startedAt);
    expect(turn.completedAt).toBe(completedAt);
  });

  it('should respect custom id when provided to DialogueTurnFactory', () => {
    const startedAt = new Date('2026-10-04T12:00:00Z');
    const completedAt = new Date('2026-10-04T12:00:01Z');

    const turn = DialogueTurnFactory.create({
      id: 'custom-turn-uuid',
      userId: 'user-1',
      messages: [],
      startedAt,
      completedAt,
    });

    expect(turn.id).toBe('custom-turn-uuid');
  });
});
