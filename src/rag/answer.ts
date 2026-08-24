import OpenAI from "openai";
import { AI_API_KEY, AI_BASE_URL, AI_MODEL, AI_SITE_URL, AI_SITE_NAME, FALLBACK_MESSAGE, SIMILARITY_THRESHOLD, TOP_K } from "../config.js";
import { retrieveTopK } from "./retrieve.js";
import { buildPrompt, formatCitations } from "./format.js";

const client = AI_API_KEY
  ? new OpenAI({
    apiKey: AI_API_KEY,
    ...(AI_BASE_URL ? { baseURL: AI_BASE_URL } : {}),
    // Used only with OpenRouter
    // ...(AI_SITE_URL || AI_SITE_NAME
    //   ? {
    //       defaultHeaders: {
    //         ...(AI_SITE_URL ? { "HTTP-Referer": AI_SITE_URL } : {}),
    //         ...(AI_SITE_NAME ? { "X-OpenRouter-Title": AI_SITE_NAME } : {}),
    //       },
    //     }
    //   : {}),
  })
  : null;

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

  const { buildPrompt, formatCitations } = await import("./format.js");
  const messages = buildPrompt(query, chunks);

  const completion = await client.chat.completions.create({
    model: AI_MODEL,
    messages,
    max_tokens: 1024,
  });

  const answer = completion.choices[0]?.message?.content?.trim();

  if (!answer) {
    throw new Error("LLM returned an empty response");
  }

  const citations = chunks
    .map((c, i) => `[${i + 1}] ${c.title} p.${c.pageStart}`)
    .join("\n");

  return `${answer}\n\nSources:\n${citations}`;
}
