import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessIncomingMessage } from '../../../src/core/use-cases/ProcessIncomingMessage';
import { MessageSenderPort } from '../../../src/core/ports/MessageSenderPort';
import { LLMPort } from '../../../src/core/ports/LLMPort';
import { PluginRegistryPort, Plugin } from '../../../src/core/ports/PluginRegistryPort';
import { Message } from '../../../src/core/entities/Message';
import { LoggerPort } from '../../../src/core/ports/LoggerPort';

describe('ProcessIncomingMessage', () => {
  let mockSender: MessageSenderPort;
  let mockLLM: LLMPort;
  let mockRegistry: PluginRegistryPort;
  let mockLogger: LoggerPort;
  let mockChildLogger: LoggerPort;

  const createMockLogger = (): LoggerPort => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  });

  beforeEach(() => {
    mockSender = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    mockLLM = { generateResponse: vi.fn() };
    mockRegistry = { getAvailablePlugins: vi.fn().mockReturnValue([]), executePlugin: vi.fn() };
    mockChildLogger = createMockLogger();
    mockLogger = createMockLogger();
    vi.mocked(mockLogger.child).mockReturnValue(mockChildLogger);
  });

  it('should process a message and send text response with structured logging', async () => {
    vi.mocked(mockLLM.generateResponse).mockResolvedValue({ text: 'Hello back!' });

    const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry, mockLogger);
    const message: Message = { id: '1', userId: 'user1', content: 'Hi', timestamp: new Date() };

    await useCase.execute(message);

    expect(mockLogger.child).toHaveBeenCalledWith({ userId: 'user1', messageId: '1' });
    expect(mockLLM.generateResponse).toHaveBeenCalledWith(
      expect.stringContaining('Iny'),
      [],
      message,
      []
    );
    expect(mockChildLogger.info).toHaveBeenCalledWith('Processing incoming message');
    expect(mockChildLogger.debug).toHaveBeenCalledWith('Available tools discovered', { count: 0 });
    expect(mockChildLogger.info).toHaveBeenCalledWith('Message processed successfully');
    expect(mockSender.sendMessage).toHaveBeenCalledWith('user1', 'Hello back!');
  });

  it('should process a message and execute plugin with tool call logging', async () => {
    vi.mocked(mockLLM.generateResponse).mockResolvedValue({
      toolCall: {
        name: 'getWeather',
        arguments: { city: 'London' }
      }
    });
    const mockPlugin: Plugin = {
      name: 'getWeather',
      description: 'Get weather for a city',
      schema: {},
      execute: vi.fn().mockResolvedValue('Sunny in London')
    };
    vi.mocked(mockRegistry.getAvailablePlugins).mockReturnValue([mockPlugin]);
    vi.mocked(mockRegistry.executePlugin).mockResolvedValue('Sunny in London');

    const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry, mockLogger);
    const message: Message = { id: '2', userId: 'user2', content: 'Weather in London?', timestamp: new Date() };

    await useCase.execute(message);

    expect(mockLogger.child).toHaveBeenCalledWith({ userId: 'user2', messageId: '2' });
    expect(mockLLM.generateResponse).toHaveBeenCalledWith(
      expect.stringContaining('Iny'),
      [],
      message,
      [mockPlugin]
    );
    expect(mockChildLogger.info).toHaveBeenCalledWith('Executing tool call', { toolName: 'getWeather' });
    expect(mockRegistry.executePlugin).toHaveBeenCalledWith('getWeather', { city: 'London' });
    expect(mockSender.sendMessage).toHaveBeenCalledWith('user2', 'Sunny in London');
    expect(mockChildLogger.info).toHaveBeenCalledWith('Message processed successfully');
  });

  it('should not send a message when LLM response contains neither text nor toolCall', async () => {
    vi.mocked(mockLLM.generateResponse).mockResolvedValue({});

    const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry, mockLogger);
    const message: Message = { id: '3', userId: 'user3', content: 'Silence', timestamp: new Date() };

    await useCase.execute(message);

    expect(mockLogger.child).toHaveBeenCalledWith({ userId: 'user3', messageId: '3' });
    expect(mockLLM.generateResponse).toHaveBeenCalled();
    expect(mockRegistry.executePlugin).not.toHaveBeenCalled();
    expect(mockSender.sendMessage).not.toHaveBeenCalled();
    expect(mockChildLogger.info).toHaveBeenCalledWith('Message processed successfully');
  });

  it('should send both text and tool result when LLM returns both text and toolCall', async () => {
    vi.mocked(mockLLM.generateResponse).mockResolvedValue({
      text: 'Checking the weather now...',
      toolCall: {
        name: 'getWeather',
        arguments: { city: 'London' }
      }
    });
    vi.mocked(mockRegistry.executePlugin).mockResolvedValue('Sunny in London');

    const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry, mockLogger);
    const message: Message = { id: '4', userId: 'user4', content: 'What is the weather in London?', timestamp: new Date() };

    await useCase.execute(message);

    expect(mockLogger.child).toHaveBeenCalledWith({ userId: 'user4', messageId: '4' });
    expect(mockSender.sendMessage).toHaveBeenCalledTimes(2);
    expect(mockSender.sendMessage).toHaveBeenNthCalledWith(1, 'user4', 'Checking the weather now...');
    expect(mockSender.sendMessage).toHaveBeenNthCalledWith(2, 'user4', 'Sunny in London');
    expect(mockChildLogger.info).toHaveBeenCalledWith('Message processed successfully');
  });

  it('should log error and send error message when LLM generateResponse throws an error', async () => {
    const error = new Error('LLM API down');
    vi.mocked(mockLLM.generateResponse).mockRejectedValue(error);

    const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry, mockLogger);
    const message: Message = { id: '5', userId: 'user5', content: 'Hello', timestamp: new Date() };

    await useCase.execute(message);

    expect(mockLogger.child).toHaveBeenCalledWith({ userId: 'user5', messageId: '5' });
    expect(mockChildLogger.error).toHaveBeenCalledWith('Failed to process message', error);
    expect(mockSender.sendMessage).toHaveBeenCalledWith('user5', 'An error occurred during processing.');
  });

  it('should log error and send error message when plugin execution throws an error', async () => {
    const error = new Error('Plugin crashed');
    vi.mocked(mockLLM.generateResponse).mockResolvedValue({
      toolCall: {
        name: 'failingPlugin',
        arguments: {}
      }
    });
    vi.mocked(mockRegistry.executePlugin).mockRejectedValue(error);

    const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry, mockLogger);
    const message: Message = { id: '6', userId: 'user6', content: 'Do something', timestamp: new Date() };

    await useCase.execute(message);

    expect(mockLogger.child).toHaveBeenCalledWith({ userId: 'user6', messageId: '6' });
    expect(mockChildLogger.error).toHaveBeenCalledWith('Failed to process message', error);
    expect(mockSender.sendMessage).toHaveBeenCalledWith('user6', 'An error occurred during processing.');
    expect(mockChildLogger.info).not.toHaveBeenCalledWith('Message processed successfully');
  });
});
