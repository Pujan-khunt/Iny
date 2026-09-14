import { describe, it, expect, vi } from 'vitest';
import { ProcessIncomingMessage } from '../../../src/core/use-cases/ProcessIncomingMessage';
import { MessageSenderPort } from '../../../src/core/ports/MessageSenderPort';
import { LLMPort } from '../../../src/core/ports/LLMPort';
import { PluginRegistryPort, Plugin } from '../../../src/core/ports/PluginRegistryPort';
import { Message } from '../../../src/core/entities/Message';

describe('ProcessIncomingMessage', () => {
  it('should process a message and send text response', async () => {
    const mockSender: MessageSenderPort = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const mockLLM: LLMPort = { generateResponse: vi.fn().mockResolvedValue({ text: 'Hello back!' }) };
    const mockRegistry: PluginRegistryPort = { getAvailablePlugins: vi.fn().mockReturnValue([]), executePlugin: vi.fn() };

    const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry);
    const message: Message = { id: '1', userId: 'user1', content: 'Hi', timestamp: new Date() };

    await useCase.execute(message);

    expect(mockRegistry.getAvailablePlugins).toHaveBeenCalled();
    expect(mockLLM.generateResponse).toHaveBeenCalledWith([], message, []);
    expect(mockSender.sendMessage).toHaveBeenCalledWith('user1', 'Hello back!');
  });

  it('should process a message and execute plugin when LLM returns a toolCall', async () => {
    const mockSender: MessageSenderPort = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const mockLLM: LLMPort = {
      generateResponse: vi.fn().mockResolvedValue({
        toolCall: {
          name: 'getWeather',
          arguments: { city: 'London' }
        }
      })
    };
    const mockPlugin: Plugin = {
      name: 'getWeather',
      description: 'Get weather for a city',
      schema: {},
      execute: vi.fn().mockResolvedValue('Sunny in London')
    };
    const mockRegistry: PluginRegistryPort = {
      getAvailablePlugins: vi.fn().mockReturnValue([mockPlugin]),
      executePlugin: vi.fn().mockResolvedValue('Sunny in London')
    };

    const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry);
    const message: Message = { id: '2', userId: 'user2', content: 'Weather in London?', timestamp: new Date() };

    await useCase.execute(message);

    expect(mockLLM.generateResponse).toHaveBeenCalledWith([], message, [mockPlugin]);
    expect(mockRegistry.executePlugin).toHaveBeenCalledWith('getWeather', { city: 'London' });
    expect(mockSender.sendMessage).toHaveBeenCalledWith('user2', 'Sunny in London');
  });

  it('should not send a message when LLM response contains neither text nor toolCall', async () => {
    const mockSender: MessageSenderPort = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const mockLLM: LLMPort = { generateResponse: vi.fn().mockResolvedValue({}) };
    const mockRegistry: PluginRegistryPort = { getAvailablePlugins: vi.fn().mockReturnValue([]), executePlugin: vi.fn() };

    const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry);
    const message: Message = { id: '3', userId: 'user3', content: 'Silence', timestamp: new Date() };

    await useCase.execute(message);

    expect(mockLLM.generateResponse).toHaveBeenCalled();
    expect(mockRegistry.executePlugin).not.toHaveBeenCalled();
    expect(mockSender.sendMessage).not.toHaveBeenCalled();
  });

  it('should send both text and tool result when LLM returns both text and toolCall', async () => {
    const mockSender: MessageSenderPort = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const mockLLM: LLMPort = {
      generateResponse: vi.fn().mockResolvedValue({
        text: 'Checking the weather now...',
        toolCall: {
          name: 'getWeather',
          arguments: { city: 'London' }
        }
      })
    };
    const mockRegistry: PluginRegistryPort = {
      getAvailablePlugins: vi.fn().mockReturnValue([]),
      executePlugin: vi.fn().mockResolvedValue('Sunny in London')
    };

    const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry);
    const message: Message = { id: '4', userId: 'user4', content: 'What is the weather in London?', timestamp: new Date() };

    await useCase.execute(message);

    expect(mockSender.sendMessage).toHaveBeenCalledTimes(2);
    expect(mockSender.sendMessage).toHaveBeenNthCalledWith(1, 'user4', 'Checking the weather now...');
    expect(mockSender.sendMessage).toHaveBeenNthCalledWith(2, 'user4', 'Sunny in London');
  });

  it('should send an error message to the user when LLM generateResponse throws an error', async () => {
    const mockSender: MessageSenderPort = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const mockLLM: LLMPort = {
      generateResponse: vi.fn().mockRejectedValue(new Error('LLM API down'))
    };
    const mockRegistry: PluginRegistryPort = {
      getAvailablePlugins: vi.fn().mockReturnValue([]),
      executePlugin: vi.fn()
    };

    const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry);
    const message: Message = { id: '5', userId: 'user5', content: 'Hello', timestamp: new Date() };

    await useCase.execute(message);

    expect(mockSender.sendMessage).toHaveBeenCalledWith('user5', 'An error occurred during processing.');
  });

  it('should send an error message to the user when plugin execution throws an error', async () => {
    const mockSender: MessageSenderPort = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const mockLLM: LLMPort = {
      generateResponse: vi.fn().mockResolvedValue({
        toolCall: {
          name: 'failingPlugin',
          arguments: {}
        }
      })
    };
    const mockRegistry: PluginRegistryPort = {
      getAvailablePlugins: vi.fn().mockReturnValue([]),
      executePlugin: vi.fn().mockRejectedValue(new Error('Plugin crashed'))
    };

    const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry);
    const message: Message = { id: '6', userId: 'user6', content: 'Do something', timestamp: new Date() };

    await useCase.execute(message);

    expect(mockSender.sendMessage).toHaveBeenCalledWith('user6', 'An error occurred during processing.');
  });
});
