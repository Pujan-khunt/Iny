import OpenAI from 'openai';
import { LLMPort, LLMResponse } from '../../../core/ports/LLMPort';
import { Message } from '../../../core/entities/Message';
import { Plugin } from '../../../core/ports/PluginRegistryPort';

export class DeepseekAdapter implements LLMPort {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com',
    });
  }

  async generateResponse(
    systemPrompt: string,
    history: Message[],
    newMessage: Message,
    plugins: Plugin[]
  ): Promise<LLMResponse> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((msg) => ({ role: 'user' as const, content: msg.content })),
      { role: 'user', content: newMessage.content },
    ];

    const tools =
      plugins.length > 0
        ? plugins.map((p) => ({
            type: 'function' as const,
            function: {
              name: p.name,
              description: p.description,
              parameters: p.schema,
            },
          }))
        : undefined;

    const response = await this.client.chat.completions.create({
      model: 'deepseek-v4.1-flash',
      messages,
      tools,
      tool_choice: tools ? 'auto' : undefined,
    });

    const responseMessage = response.choices[0].message;

    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      const toolCall = responseMessage.tool_calls[0];
      if (toolCall.type === 'function') {
        return {
          toolCall: {
            name: toolCall.function.name,
            arguments: JSON.parse(toolCall.function.arguments),
          },
        };
      }
    }

    return { text: responseMessage.content || '' };
  }
}
