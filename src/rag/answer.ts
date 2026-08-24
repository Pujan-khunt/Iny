import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { AI_API_KEY, AI_BASE_URL, AI_MODEL, FALLBACK_MESSAGE, SIMILARITY_THRESHOLD, TOP_K, MAX_CITATIONS } from "../config.js";
import { retrieveTopK } from "./retrieve.js";
import { formatCitations, SYSTEM_PROMPT } from "./format.js";

const client = AI_API_KEY
  ? new OpenAI({
      apiKey: AI_API_KEY,
      ...(AI_BASE_URL ? { baseURL: AI_BASE_URL } : {}),
    })
  : null;

/**
 * Convert Markdown formatting to WhatsApp-compatible formatting
 * This handles cases where the LLM outputs Markdown despite prompt instructions
 */
function convertMarkdownToWhatsApp(text: string): string {
  // Convert **text** (bold) to *text* (single asterisk)
  text = text.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Convert __text__ (bold) to *text*
  text = text.replace(/__(.+?)__/g, "*$1*");

  // Convert ~~text~~ (strikethrough) to ~text~
  text = text.replace(/~~(.+?)~~/g, "~$1~");

  // Remove # headings (they don't work in WhatsApp)
  // Convert "# Heading" to "*Heading*" for emphasis
  text = text.replace(/^### (.+)$/gm, "*$1*");
  text = text.replace(/^## (.+)$/gm, "*$1*");
  text = text.replace(/^# (.+)$/gm, "*$1*");

  return text;
}

export interface AskOptions {
  threshold?: number;
  topK?: number;
}

export async function askWithContext(query: string, opts: AskOptions = {}): Promise<string> {
  if (!client) {
    throw new Error("AI_API_KEY is not configured");
  }

  const retrieveOpts = { threshold: opts.threshold, topK: opts.topK } as { threshold?: number; topK?: number };
  const chunks = await retrieveTopK(query, retrieveOpts);

  if (chunks.length === 0) {
    return FALLBACK_MESSAGE;
  }

  const contextBlock = chunks
    .map((c, i) => `[${i + 1}] ${c.content}`)
    .join("\n\n");

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: `Context:\n${chunks.map((c, i) => `[${i + 1}] ${c.content}`).join("\n\n")}` },
    { role: "user", content: query },
  ];

  const completion = await client!.chat.completions.create({
    model: AI_MODEL,
    messages,
    max_tokens: 1024,
  });

  let answer = completion.choices[0]?.message?.content?.trim();

  if (!answer) {
    throw new Error("LLM returned an empty response");
  }

  // Convert Markdown formatting to WhatsApp-compatible format
  answer = convertMarkdownToWhatsApp(answer);

  const limitedChunks = chunks.slice(0, MAX_CITATIONS);
  const citations = formatCitations(limitedChunks);

  return `${answer}\n\n${citations}`;
}