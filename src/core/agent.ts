/**
 * Core Agent Service: Channel-Agnostic LLM + Tool Calling Engine
 *
 * Implements the core agentic RAG loop:
 * 1. Assemble system prompt + multi-turn history + user query
 * 2. Invoke LLM with available tools
 * 3. Execute tools with linear backoff retries
 * 4. Collect retrieved source chunks
 * 5. Return final answer in standard Markdown
 */

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
import { TOOL_SCHEMAS } from "../rag/tools.js";
import type { ToolCall, ToolResult } from "../rag/tools.js";
import { createToolExecutors, type ToolExecutionResult } from "../rag/toolExecutors.js";
import type { ConversationTurn, RetrievedChunk } from "./types.js";

const logger = getLogger("core-agent");

const MISSING_INFO_FALLBACK =
  "I don't have that information in my current knowledge base. Try rephrasing your question or ask about a different topic.";

const client = AI_API_KEY
  ? new OpenAI({
      apiKey: AI_API_KEY,
      ...(AI_BASE_URL ? { baseURL: AI_BASE_URL } : {}),
    })
  : null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeToolCallWithRetry(
  toolCall: ToolCall,
  executors: Record<string, (args: Record<string, unknown>) => Promise<ToolExecutionResult>>,
  maxRetries: number,
  baseDelay: number,
): Promise<ToolExecutionResult> {
  const toolName = toolCall.function.name;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const executor = executors[toolName];
      if (!executor) {
        throw new Error(`Unknown tool: ${toolName}`);
      }

      const args = JSON.parse(toolCall.function.arguments);
      const result = await executor(args);

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

/**
 * Runs the core agentic RAG loop.
 * Operates purely in standard universal Markdown.
 */
export async function executeAgent(
  userMessage: string,
  history: ConversationTurn[] = [],
  style?: string,
  customStylePrompt?: string,
): Promise<AgentExecutionResult> {
  if (!client) {
    throw new Error("AI_API_KEY is not configured");
  }

  const executors = createToolExecutors();
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

  // Compact per-iteration trace accumulated for the max-iterations diagnostic log.
  const iterationTrace: Array<{
    iteration: number;
    finishReason: string | null | undefined;
    toolCalls: Array<{ name: string; args: string }>;
    toolResults: Array<{ name: string; success: boolean; chunkCount: number }>;
  }> = [];

  while (iteration < AGENT_CONFIG.maxIterations) {
    iteration++;

    logger.info(
      { iteration, maxIterations: AGENT_CONFIG.maxIterations, messageCount: messages.length },
      "Agent iteration started",
    );

    try {
      // Step 1: Query LLM with tools
      const response = await client.chat.completions.create({
        model: AI_MODEL,
        messages,
        tools: TOOL_SCHEMAS,
        tool_choice: "auto",
        max_tokens: 1024,
      });

      const choice = response.choices[0];
      const responseMessage = choice?.message;
      if (!responseMessage) {
        throw new Error("No response from LLM");
      }

      const finishReason = choice?.finish_reason;

      // Step 2: Final response check
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

      // Step 3: Tool execution
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

      const iterationToolResults: Array<{ name: string; success: boolean; chunkCount: number }> =
        [];

      for (const toolCall of functionToolCalls) {
        const executionResult = await executeToolCallWithRetry(
          {
            id: toolCall.id,
            type: "function",
            function: toolCall.function,
          },
          executors,
          AGENT_CONFIG.retryAttempts,
          AGENT_CONFIG.retryBaseDelay,
        );

        // Parse success flag from result JSON for structured logging
        let resultSuccess = true;
        try {
          const parsed = JSON.parse(executionResult.content) as { success?: boolean };
          resultSuccess = parsed.success !== false;
        } catch {
          // ignore parse errors — treat as success
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

        // Accumulate retrieved sources
        if (executionResult.chunks.length > 0) {
          collectedSources.push(...executionResult.chunks);
        }

        // Add tool result to conversation history
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: executionResult.content,
        } as ToolResult);
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

  // Full diagnostic trace — visible at warn level without needing LOG_LEVEL=debug.
  logger.warn(
    {
      maxIterations: AGENT_CONFIG.maxIterations,
      userMessage,
      iterationTrace,
      hint:
        "LLM kept calling tools without producing a final text response. " +
        "Diagnosis guide — check iterationTrace: " +
        "(1) repeated identical tool args = retrieval loop; " +
        "(2) chunkCount=0 on all results = query never matched embeddings; " +
        "(3) finishReason='length' = model hit max_tokens mid-response and truncated its answer.",
    },
    "Agent reached maximum iterations without final response",
  );

  return {
    message: MISSING_INFO_FALLBACK,
    sources: collectedSources,
    iterations: iteration,
  };
}
