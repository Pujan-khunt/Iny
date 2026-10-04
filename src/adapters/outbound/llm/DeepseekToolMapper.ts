import OpenAI from 'openai';
import { ToolDefinition } from '../../../core/ports/ToolRegistryPort';

/**
 * Pure mapper translating domain ToolDefinition entities into OpenAI ChatCompletion tool definitions.
 *
 * @param tools Array of domain tool definitions available to the model.
 * @param forcedSynthesis When true, returns undefined to suppress tool calls and force natural language synthesis.
 * @returns Array of OpenAI tools or undefined if empty or suppressed.
 */
export function mapToolDefinitionsToOpenAI(
  tools: ToolDefinition[],
  forcedSynthesis?: boolean
): OpenAI.Chat.ChatCompletionTool[] | undefined {
  if (forcedSynthesis || tools.length === 0) {
    return undefined;
  }
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.schema,
    },
  }));
}
