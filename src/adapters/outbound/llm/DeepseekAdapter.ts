import OpenAI from 'openai';
import { LLMPort, LLMResponse, GenerateResponseOptions } from '../../../core/ports/LLMPort';
import { Message } from '../../../core/entities/Message';
import { ToolDefinition } from '../../../core/ports/ToolRegistryPort';
import { LoggerPort } from '../../../core/ports/LoggerPort';
import {
  mapDomainMessagesToOpenAI,
  mapToolDefinitionsToOpenAI,
} from './DeepseekMessageMapper';
import { parseOpenAIResponse } from './DeepseekResponseParser';
import { translateAndThrowDeepseekError } from './DeepseekErrorTranslator';

/**
 * Configuration options for the DeepSeek LLM adapter.
 */
export interface DeepseekAdapterOptions {
  baseURL?: string;
  model?: string;
  logger?: LoggerPort;
}

/**
 * Lightweight outbound adapter coordinating communication with the DeepSeek API.
 * Delegates message mapping, response parsing, and error translation to pure modules.
 */
export class DeepseekAdapter implements LLMPort {
  private readonly client: OpenAI;
  private readonly baseURL: string;
  private readonly model: string;
  private readonly logger?: LoggerPort;

  constructor(apiKey: string, options?: DeepseekAdapterOptions) {
    this.logger = options?.logger;
    this.baseURL = options?.baseURL ?? 'https://api.deepseek.com';
    this.model = options?.model ?? 'deepseek-flash';

    this.client = new OpenAI({
      apiKey,
      baseURL: this.baseURL,
    });
  }

  /**
   * Generates a completion decision from the DeepSeek model.
   *
   * @param systemPrompt System instructions for the model.
   * @param messages Chronological sequence of dialogue messages.
   * @param tools Available tool definitions for function calling.
   * @param options Optional generation controls such as forced synthesis.
   * @returns Parsed model decision: either tool calls or text response.
   */
  async generateResponse(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[],
    options?: GenerateResponseOptions
  ): Promise<LLMResponse> {
    const openAIMessages = mapDomainMessagesToOpenAI(systemPrompt, messages);
    const openAITools = mapToolDefinitionsToOpenAI(tools, options?.forcedSynthesis);

    this.logger?.debug('Sending request to Deepseek LLM', {
      model: this.model,
      messageCount: openAIMessages.length,
    });

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: openAIMessages,
        tools: openAITools,
        tool_choice: openAITools ? 'auto' : undefined,
      });
      return parseOpenAIResponse(response, this.logger);
    } catch (error) {
      translateAndThrowDeepseekError(error);
    }
  }
}
