import { Plugin } from './PluginRegistryPort';
import { Message, ToolCall } from '../entities/Message';

export interface ToolCallDecision {
  type: 'tool_calls';
  toolCalls: ToolCall[];
  thought?: string;
}

export interface TextResponseDecision {
  type: 'text';
  content: string;
  thought?: string;
}

export type LLMResponse = ToolCallDecision | TextResponseDecision;

export interface GenerateResponseOptions {
  forcedSynthesis?: boolean;
}

export interface LLMPort {
  generateResponse(
    systemPrompt: string,
    history: Message[],
    plugins: Plugin[],
    options?: GenerateResponseOptions
  ): Promise<LLMResponse>;
}
