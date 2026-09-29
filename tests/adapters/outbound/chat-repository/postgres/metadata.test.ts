import { describe, it, expect } from 'vitest';
import { extractTurnMetadata } from '../../../../../src/adapters/outbound/chat-repository/postgres/metadata';
import { DialogueTurn } from '../../../../../src/core/entities/DialogueTurn';

describe('extractTurnMetadata', () => {
  it('should extract user query, assistant response, and empty toolNames for standard turns', () => {
    const turn: DialogueTurn = {
      id: 'turn-1',
      userId: 'user1',
      startedAt: new Date(),
      completedAt: new Date(),
      messages: [
        { id: 'm1', userId: 'user1', role: 'user', content: 'Hello Iny', timestamp: new Date() },
        { id: 'm2', role: 'assistant', type: 'text', content: 'Hello! How can I help?' },
      ],
    };

    const metadata = extractTurnMetadata(turn);
    expect(metadata.userQuery).toBe('Hello Iny');
    expect(metadata.assistantResponse).toBe('Hello! How can I help?');
    expect(metadata.toolNames).toEqual([]);
  });

  it('should extract and deduplicate tool names across tool call messages', () => {
    const turn: DialogueTurn = {
      id: 'turn-2',
      userId: 'user1',
      startedAt: new Date(),
      completedAt: new Date(),
      messages: [
        { id: 'm1', userId: 'user1', role: 'user', content: 'Calculate 2+2 and 3+3', timestamp: new Date() },
        {
          id: 'm2',
          role: 'assistant',
          type: 'tool_calls',
          toolCalls: [
            { id: 'c1', name: 'CalculatorTool', args: { expr: '2+2' } },
            { id: 'c2', name: 'CalculatorTool', args: { expr: '3+3' } },
          ],
        },
        { id: 'm3', role: 'tool', toolCallId: 'c1', toolName: 'CalculatorTool', result: '4' },
        { id: 'm4', role: 'tool', toolCallId: 'c2', toolName: 'CalculatorTool', result: '6' },
        { id: 'm5', role: 'assistant', type: 'text', content: 'Results are 4 and 6.' },
      ],
    };

    const metadata = extractTurnMetadata(turn);
    expect(metadata.userQuery).toBe('Calculate 2+2 and 3+3');
    expect(metadata.assistantResponse).toBe('Results are 4 and 6.');
    expect(metadata.toolNames).toEqual(['CalculatorTool']);
  });
});
