import { Plugin } from './PluginRegistryPort';
import { Message } from '../entities/Message';

export interface LLMResponse {
  text?: string;
  toolCall?: {
    name: string;
    arguments: any;
  };
}

export interface LLMPort {
  generateResponse(history: Message[], newMessage: Message, plugins: Plugin[]): Promise<LLMResponse>;
}
