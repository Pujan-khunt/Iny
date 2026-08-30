/**
 * Agent Service: Orchestrates LLM + Tool Loop
 *
 * This implements the agentic RAG pattern:
 * 1. Send user query + tools to LLM
 * 2. Check if LLM wants to call tools
 * 3. Execute tools locally with retry logic
 * 4. Send results back to LLM
 * 5. Loop until LLM returns final answer or max iterations reached
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getLogger } from "../logger.js";
import {
  AI_API_KEY,
  AI_BASE_URL,
  AI_MODEL,
  FALLBACK_MESSAGE,
  AGENT_CONFIG,
} from "../config.js";
import { SYSTEM_PROMPT } from "../rag/systemPrompt.js";
import { TOOL_SCHEMAS } from "../rag/tools.js";
import type { ToolCall, ToolResult } from "../rag/tools.js";
import { createToolExecutors, type ToolExecutionResult } from "../rag/toolExecutors.js";
import { cacheSourcesForUser } from "./sourceCache.js";
import { convertMarkdownToWhatsApp } from "../utils/markdown.js";

const logger = getLogger("agent");

const client = AI_API_KEY
  ? new OpenAI({
    apiKey: AI_API_KEY,
    ...(AI_BASE_URL ? { baseURL: AI_BASE_URL } : {}),
  })
  : null;

/**
 * Sleep utility for retry delays with linear backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a tool call with retry logic and linear backoff.
 * Returns a ToolExecutionResult containing both the LLM-facing JSON string
 * and the raw retrieved chunks for source caching.
 */
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

      // Linear backoff: attempt 0 → 500ms, attempt 1 → 1000ms, attempt 2 → 1500ms
      if (attempt < maxRetries - 1) {
        await sleep(baseDelay * (attempt + 1));
      }
    }
  }

  // All retries failed — return an error payload so the LLM can handle it gracefully
  const errorMessage = lastError?.message ?? "Unknown error";
  logger.error({ tool: toolName, retryCount: maxRetries, finalError: errorMessage }, "Tool execution failed after all retries");

  return {
    content: JSON.stringify({
      success: false,
      message: `Tool failed after ${maxRetries} retries: ${errorMessage}`,
      results: [],
    }),
    chunks: [],
  };
}

/**
 * Main agent function — orchestrates the LLM + tool loop.
 * Creates a fresh set of tool executors per invocation to guarantee
 * isolation between concurrent requests.
 *
 * @param userMessage - The user's query
 * @param userJid     - User JID used for source caching (optional)
 * @param history     - Optional multi-turn conversation history for context
 * @returns The agent's final response formatted for WhatsApp
 */
export async function runAgent(
  userMessage: string,
  userJid?: string,
  history?: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string> {
  if (!client) {
    throw new Error("AI_API_KEY is not configured");
  }

  // Per-request executors — no shared mutable state between concurrent users
  const executors = createToolExecutors();

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(history ?? []),
    { role: "user", content: userMessage },
  ];

  logger.info({ userMessage, userJid, historyTurns: (history?.length ?? 0) / 2 }, "Agent started");

  let iteration = 0;

  // Agentic loop: continue until final answer or max iterations
  while (iteration < AGENT_CONFIG.maxIterations) {
    iteration++;

    logger.debug({ iteration, messageCount: messages.length }, "Agent iteration started");

    try {
      // Step 1: Send to LLM with available tools
      const response = await client.chat.completions.create({
        model: AI_MODEL,
        messages,
        tools: TOOL_SCHEMAS,
        tool_choice: "auto",
        max_tokens: 1024,
      });

      const responseMessage = response.choices[0]?.message;
      if (!responseMessage) {
        throw new Error("No response from LLM");
      }

      // Step 2: Check if LLM wants to call tools
      if (!responseMessage.tool_calls || responseMessage.tool_calls.length === 0) {
        // Final answer — no more tool calls requested
        const finalAnswer = responseMessage.content ?? FALLBACK_MESSAGE;

        logger.info({ iteration, hasToolCalls: false }, "Agent reached final response");

        // Convert any Markdown formatting to WhatsApp format
        return convertMarkdownToWhatsApp(finalAnswer);
      }

      // Step 3: Add assistant message (contains tool call requests) to history
      messages.push(responseMessage);

      const functionToolCalls = responseMessage.tool_calls.filter(
        (tc) => tc.type === "function",
      );

      logger.info(
        {
          iteration,
          toolCallCount: functionToolCalls.length,
          toolNames: functionToolCalls.map((tc) => tc.function.name),
        },
        "LLM requested tool calls",
      );

      // Step 4: Execute each tool call and append results to history
      for (const toolCall of functionToolCalls) {
        logger.debug(
          {
            toolName: toolCall.function.name,
            toolCallId: toolCall.id,
            arguments: toolCall.function.arguments,
          },
          "Executing tool call",
        );

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

        // Cache retrieved chunks for the "show sources" feature
        if (toolCall.function.name === "search_policy_database" && userJid) {
          if (executionResult.chunks.length > 0) {
            cacheSourcesForUser(userJid, executionResult.chunks);
            logger.debug(
              { userJid, chunkCount: executionResult.chunks.length },
              "Sources cached after tool execution",
            );
          }
        }

        // Step 5: Add tool result to messages so LLM can see it
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: executionResult.content,
        } as ToolResult);

        logger.debug(
          { toolName: toolCall.function.name, resultLength: executionResult.content.length },
          "Tool result added to messages",
        );
      }

      // Loop continues: LLM will see tool results and decide next step
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error({ iteration, error: errorMessage }, "Agent iteration error");

      return "I'm having trouble processing your request. Please try again.";
    }
  }

  // Max iterations reached without final response
  logger.warn({ maxIterations: AGENT_CONFIG.maxIterations }, "Agent reached maximum iterations without final response");

  return FALLBACK_MESSAGE;
}
