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
import pino from "pino";
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
import { TOOL_EXECUTORS, getLastToolExecutionChunks, clearLastToolExecutionChunks } from "../rag/toolExecutors.js";
import { cacheSourcesForUser } from "./sourceCache.js";
import { convertMarkdownToWhatsApp } from "../utils/markdown.js";

const logger = pino();

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
 * Execute a tool call with retry logic and linear backoff
 * Returns the tool result as a JSON string for LLM consumption
 */
async function executeToolCallWithRetry(
  toolCall: ToolCall,
  maxRetries: number,
  baseDelay: number
): Promise<string> {
  const toolName = toolCall.function.name;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const executor = TOOL_EXECUTORS[toolName];
      if (!executor) {
        throw new Error(`Unknown tool: ${toolName}`);
      }

      const args = JSON.parse(toolCall.function.arguments);
      const result = await executor(args);

      logger.info(
        {
          tool: toolName,
          attempt: attempt + 1,
          timestamp: new Date().toISOString(),
        },
        "Tool execution succeeded"
      );

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      logger.warn(
        {
          tool: toolName,
          attempt: attempt + 1,
          error: lastError.message,
          timestamp: new Date().toISOString(),
        },
        "Tool execution failed, retrying..."
      );

      // Linear backoff: attempt 0 → 500ms, attempt 1 → 1000ms, attempt 2 → 1500ms
      if (attempt < maxRetries - 1) {
        const delayMs = baseDelay * (attempt + 1);
        await sleep(delayMs);
      }
    }
  }

  // All retries failed - return error in same format so LLM can handle it gracefully
  const errorMessage = lastError?.message || "Unknown error";
  logger.error(
    {
      tool: toolName,
      retryCount: maxRetries,
      finalError: errorMessage,
      timestamp: new Date().toISOString(),
    },
    "Tool execution failed after all retries"
  );

  return JSON.stringify({
    success: false,
    message: `Tool failed after ${maxRetries} retries: ${errorMessage}`,
    results: [],
  });
}

/**
 * Main agent function - orchestrates the LLM + tool loop
 * Implements the agentic RAG pattern with automatic tool calling
 *
 * @param userMessage - The user's query
 * @param userJid - Optional: User JID for source caching
 * @returns The agent's final response
 */
export async function runAgent(userMessage: string, userJid?: string): Promise<string> {
  if (!client) {
    throw new Error("AI_API_KEY is not configured");
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  logger.info(
    { userMessage, userJid },
    "Agent started"
  );

  let iteration = 0;

  // Agentic loop: continue until final answer or max iterations
  while (iteration < AGENT_CONFIG.maxIterations) {
    iteration++;

    logger.debug(
      {
        iteration,
        messageCount: messages.length,
        timestamp: new Date().toISOString(),
      },
      "Agent iteration started"
    );

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
        // Final answer - no more tool calls requested
        const finalAnswer = responseMessage.content || FALLBACK_MESSAGE;

        logger.info(
          {
            iteration,
            hasToolCalls: false,
            timestamp: new Date().toISOString(),
          },
          "Agent reached final response"
        );

        // Convert any Markdown formatting to WhatsApp format
        return convertMarkdownToWhatsApp(finalAnswer);
      }

      // Tool calls requested - log and execute
      const functionToolCalls = responseMessage.tool_calls.filter(
        (tc) => tc.type === "function"
      );

      logger.info(
        {
          iteration,
          toolCallCount: functionToolCalls.length,
          toolNames: functionToolCalls.map(
            (tc) => (tc as { function: { name: string } }).function.name
          ),
          timestamp: new Date().toISOString(),
        },
        "LLM requested tool calls"
      );

      // Step 3: Add assistant response to messages (contains tool call requests)
      messages.push(responseMessage);

       // Step 4: Execute each tool call
       for (const toolCall of functionToolCalls) {
         const functionCall = toolCall as { function: { name: string; arguments: string } };
         logger.debug(
           {
             toolName: functionCall.function.name,
             toolCallId: toolCall.id,
             arguments: functionCall.function.arguments,
             timestamp: new Date().toISOString(),
           },
           "Executing tool call"
         );

         const toolResult = await executeToolCallWithRetry(
           {
             id: toolCall.id,
             type: "function",
             function: functionCall.function,
           },
           AGENT_CONFIG.retryAttempts,
           AGENT_CONFIG.retryBaseDelay
         );

         // Step 4b: Cache sources if tool was search_policy_database
         if (functionCall.function.name === "search_policy_database" && userJid) {
           const chunks = getLastToolExecutionChunks();
           if (chunks.length > 0) {
             cacheSourcesForUser(userJid, chunks);
             logger.debug(
               {
                 userJid,
                 chunkCount: chunks.length,
                 timestamp: new Date().toISOString(),
               },
               "Sources cached after tool execution"
             );
           }
           clearLastToolExecutionChunks();
         }

         // Step 5: Add tool result to messages so LLM can see it
         messages.push({
           role: "tool",
           tool_call_id: toolCall.id,
           name: toolCall.function.name,
           content: toolResult,
         } as ToolResult);

         logger.debug(
           {
             toolName: toolCall.function.name,
             resultLength: toolResult.length,
             timestamp: new Date().toISOString(),
           },
           "Tool result added to messages"
         );
       }

      // Loop continues: LLM will see tool results and decide next step
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.error(
        {
          iteration,
          error: errorMessage,
          timestamp: new Date().toISOString(),
        },
        "Agent iteration error"
      );

      // Return graceful error to user
      return "I'm having trouble processing your request. Please try again.";
    }
  }

  // Max iterations reached without final response
  logger.warn(
    {
      maxIterations: AGENT_CONFIG.maxIterations,
      timestamp: new Date().toISOString(),
    },
    "Agent reached maximum iterations without final response"
  );

  return FALLBACK_MESSAGE;
}
