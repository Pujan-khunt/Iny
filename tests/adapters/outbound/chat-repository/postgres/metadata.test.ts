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
        { id: 'm2', userId: 'user1', role: 'assistant', content: 'Hello! How can I help?', timestamp: new Date() },
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
          userId: 'user1',
          role: 'assistant',
          toolCalls: [
            { type: 'valid', id: 'c1', name: 'CalculatorTool', arguments: { expr: '2+2' } },
            { type: 'valid', id: 'c2', name: 'CalculatorTool', arguments: { expr: '3+3' } },
          ],
          timestamp: new Date(),
        },
        { id: 'm3', userId: 'user1', role: 'tool', toolCallId: 'c1', name: 'CalculatorTool', content: '4', timestamp: new Date() },
        { id: 'm4', userId: 'user1', role: 'tool', toolCallId: 'c2', name: 'CalculatorTool', content: '6', timestamp: new Date() },
        { id: 'm5', userId: 'user1', role: 'assistant', content: 'Results are 4 and 6.', timestamp: new Date() },
      ],
    };

    const metadata = extractTurnMetadata(turn);
    expect(metadata.userQuery).toBe('Calculate 2+2 and 3+3');
    expect(metadata.assistantResponse).toBe('Results are 4 and 6.');
    expect(metadata.toolNames).toEqual(['CalculatorTool']);
    expect(metadata.reasoning).toEqual([]);
  });

  it('should extract reasoning across intermediate tool calls and final text', () => {
    const turn: DialogueTurn = {
      id: 'turn-3',
      userId: 'user1',
      startedAt: new Date(),
      completedAt: new Date(),
      messages: [
        { id: 'm1', userId: 'user1', role: 'user', content: 'What is the weather?', timestamp: new Date() },
        {
          id: 'm2',
          userId: 'user1',
          role: 'assistant',
          reasoning: 'Need to check location first.',
          toolCalls: [{ type: 'valid', id: 'c1', name: 'GetWeather', arguments: { city: 'Tokyo' } }],
          timestamp: new Date(),
        },
        { id: 'm3', userId: 'user1', role: 'tool', toolCallId: 'c1', name: 'GetWeather', content: 'Sunny 22C', timestamp: new Date() },
        {
          id: 'm4',
          userId: 'user1',
          role: 'assistant',
          reasoning: 'Synthesizing weather summary.',
          content: 'The weather in Tokyo is sunny at 22C.',
          timestamp: new Date(),
        },
      ],
    };

    const metadata = extractTurnMetadata(turn);
    expect(metadata.userQuery).toBe('What is the weather?');
    expect(metadata.assistantResponse).toBe('The weather in Tokyo is sunny at 22C.');
    expect(metadata.toolNames).toEqual(['GetWeather']);
    expect(metadata.reasoning).toEqual([
      'Need to check location first.',
      'Synthesizing weather summary.',
    ]);
  });
});
