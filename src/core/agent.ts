import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  AI_API_KEY,
  AI_BASE_URL,
  AI_MODEL,
  AGENT_CONFIG,
} from "../config.js";
import { getLogger } from "../logger.js";
import { getSystemPrompt } from "../rag/systemPrompt.js";
import type { ToolRegistry, ToolExecutionResult } from "../rag/tool.js";
import type { ConversationTurn, RetrievedChunk } from "./types.js";

const logger = getLogger("core-agent");

const MISSING_INFO_FALLBACK =
  "I don't have that information in my current knowledge base. Try rephrasing your question or ask about a different topic.";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AgentDeps {
  client: OpenAI;
  config: {
    maxIterations: number;
    retryAttempts: number;
    retryBaseDelay: number;
  };
}

export async function executeToolCallWithRetry(
  toolCall: { id: string; type: "function"; function: { name: string; arguments: string } },
  registry: ToolRegistry,
  maxRetries: number,
  baseDelay: number,
): Promise<ToolExecutionResult> {
  const toolName = toolCall.function.name;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const tool = registry.get(toolName);
      if (!tool) {
        throw new Error(`Unknown tool: ${toolName}`);
      }

      const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
      const result = await tool.execute(args);

      logger.info({ tool: toolName, attempt: attempt + 1 }, "Tool execution succeeded");
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      logger.warn(
        { tool: toolName, attempt: attempt + 1, error: lastError.message },
        "Tool execution failed, retrying...",
      );

      if (attempt < maxRetries - 1) {
        await sleep(baseDelay * (attempt + 1));
      }
    }
  }

  const errorMessage = lastError?.message ?? "Unknown error";
  logger.error(
    { tool: toolName, retryCount: maxRetries, finalError: errorMessage },
    "Tool execution failed after all retries",
  );

  return {
    content: JSON.stringify({
      success: false,
      message: `Tool failed after ${maxRetries} retries: ${errorMessage}`,
      results: [],
    }),
    chunks: [],
  };
}

export interface AgentExecutionResult {
  message: string;
  sources: RetrievedChunk[];
  iterations: number;
}

export interface Agent {
  executeAgent(
    userMessage: string,
    history: ConversationTurn[],
    registry: ToolRegistry,
    style?: string,
    customStylePrompt?: string,
  ): Promise<AgentExecutionResult>;
}

export function createAgent(deps: AgentDeps): Agent {
  return {
    async executeAgent(
      userMessage: string,
      history: ConversationTurn[] = [],
      registry: ToolRegistry,
      style?: string,
      customStylePrompt?: string,
    ): Promise<AgentExecutionResult> {
      const collectedSources: RetrievedChunk[] = [];
      const systemPrompt = getSystemPrompt(style, customStylePrompt);

      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: userMessage },
      ];

      logger.info(
        { userMessage, style: style ?? "default", historyTurns: history.length / 2 },
        "Core agent execution started",
      );

      let iteration = 0;

      const iterationTrace: Array<{
        iteration: number;
        finishReason: string | null | undefined;
        toolCalls: Array<{ name: string; args: string }>;
        toolResults: Array<{ name: string; success: boolean; chunkCount: number }>;
      }> = [];

      while (iteration < deps.config.maxIterations) {
        iteration++;

        logger.info(
          { iteration, maxIterations: deps.config.maxIterations, messageCount: messages.length },
          "Agent iteration started",
        );

        try {
          const response = await deps.client.chat.completions.create({
            model: AI_MODEL,
            messages,
            tools: registry.schemas(),
            tool_choice: "auto",
            max_tokens: 1024,
          });

          const choice = response.choices[0];
          const responseMessage = choice?.message;
          if (!responseMessage) {
            throw new Error("No response from LLM");
          }

          const finishReason = choice?.finish_reason;

          if (!responseMessage.tool_calls || responseMessage.tool_calls.length === 0) {
            const finalAnswer = responseMessage.content ?? MISSING_INFO_FALLBACK;

            logger.info(
              { iteration, finishReason, contentLength: finalAnswer.length },
              "Agent reached final response",
            );

            return {
              message: finalAnswer,
              sources: collectedSources,
              iterations: iteration,
            };
          }

          messages.push(responseMessage);

          const functionToolCalls = responseMessage.tool_calls.filter(
            (tc) => tc.type === "function",
          );

          logger.info(
            {
              iteration,
              finishReason,
              toolCallCount: functionToolCalls.length,
              tools: functionToolCalls.map((tc) => ({
                name: tc.function.name,
                args: tc.function.arguments,
              })),
            },
            "LLM requested tool calls",
          );

          const iterationToolResults: Array<{ name: string; success: boolean; chunkCount: number }> = [];

          for (const toolCall of functionToolCalls) {
            const executionResult = await executeToolCallWithRetry(
              {
                id: toolCall.id,
                type: "function",
                function: toolCall.function,
              },
              registry,
              deps.config.retryAttempts,
              deps.config.retryBaseDelay,
            );

            let resultSuccess = true;
            try {
              const parsed = JSON.parse(executionResult.content) as { success?: boolean };
              resultSuccess = parsed.success !== false;
            } catch {
            }

            const toolResultSummary = {
              name: toolCall.function.name,
              success: resultSuccess,
              chunkCount: executionResult.chunks.length,
            };
            iterationToolResults.push(toolResultSummary);

            logger.info(
              {
                iteration,
                toolName: toolCall.function.name,
                args: toolCall.function.arguments,
                success: resultSuccess,
                chunkCount: executionResult.chunks.length,
              },
              "Tool execution completed",
            );

            if (executionResult.chunks.length > 0) {
              collectedSources.push(...executionResult.chunks);
            }

            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: executionResult.content,
            });
          }

          iterationTrace.push({
            iteration,
            finishReason,
            toolCalls: functionToolCalls.map((tc) => ({
              name: tc.function.name,
              args: tc.function.arguments,
            })),
            toolResults: iterationToolResults,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          logger.error({ iteration, error: errorMessage }, "Agent iteration error");

          return {
            message: "I'm having trouble processing your request. Please try again.",
            sources: collectedSources,
            iterations: iteration,
          };
        }
      }

      logger.warn(
        {
          maxIterations: deps.config.maxIterations,
          userMessage,
          iterationTrace,
          hint: "LLM kept calling tools without producing a final text response.",
        },
        "Agent reached maximum iterations without final response",
      );

      return {
        message: MISSING_INFO_FALLBACK,
        sources: collectedSources,
        iterations: iteration,
      };
    }
  };
}

const defaultClient = AI_API_KEY
  ? new OpenAI({
      apiKey: AI_API_KEY,
      ...(AI_BASE_URL ? { baseURL: AI_BASE_URL } : {}),
    })
  : null;

const defaultAgent = defaultClient ? createAgent({
  client: defaultClient,
  config: {
    maxIterations: AGENT_CONFIG.maxIterations,
    retryAttempts: AGENT_CONFIG.retryAttempts,
    retryBaseDelay: AGENT_CONFIG.retryBaseDelay,
  }
}) : {
  executeAgent: async () => {
    throw new Error("AI_API_KEY is not configured");
  }
};

export const executeAgent = defaultAgent.executeAgent;
