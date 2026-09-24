import { ToolDefinition } from './ToolRegistryPort';
import { Message } from '../entities/Message';
import { ToolCall } from '../entities/ToolCall';

/**
 * Base interface for LLM decisions containing optional chain-of-thought reasoning.
 */
export interface BaseLLMDecision {
  /** Optional reasoning or scratchpad content emitted by the model. */
  thought?: string;
}

/**
 * A decision from the LLM requesting one or more tool calls.
 */
export interface ToolCallDecision extends BaseLLMDecision {
  type: 'tool_calls';
  toolCalls: ToolCall[];
}

/**
 * A decision from the LLM providing a final natural language text response.
 */
export interface TextResponseDecision extends BaseLLMDecision {
  type: 'text';
  content: string;
}

/**
 * Discriminated union of possible LLM completion decisions.
 * Discriminant is the "type" property ('tool_calls' | 'text').
 */
export type LLMResponse = ToolCallDecision | TextResponseDecision;

/**
 * Optional execution flags for response generation.
 */
export interface GenerateResponseOptions {
  /** When true, forces the model to synthesize text instead of invoking tools. */
  forcedSynthesis?: boolean;
}

/**
 * Outbound port for language model reasoning and tool call generation.
 */
export interface LLMPort {
  /**
   * Generates a reasoning decision or response given system prompt, conversation history, and tool definitions.
   *
   * @param systemPrompt System instructions for the language model.
   * @param messages Chronological sequence of messages in the dialogue.
   * @param tools Read-only metadata for tools available to the model.
   * @param options Optional configuration flags such as forced synthesis.
   * @returns Model decision: either a tool call request or a natural language text response.
   */
  generateResponse(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[],
    options?: GenerateResponseOptions
  ): Promise<LLMResponse>;
}
