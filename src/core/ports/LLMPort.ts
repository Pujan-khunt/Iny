import { Plugin } from './PluginRegistryPort';
import { Message } from '../entities/Message';

export interface LLMResponse {
  text?: string;
  toolCall?: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface LLMPort {
  generateResponse(systemPrompt: string, history: Message[], newMessage: Message, plugins: Plugin[]): Promise<LLMResponse>;
}
