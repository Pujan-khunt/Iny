import OpenAI from "openai";
import { EMBEDDING_MODEL, OPENAI_API_KEY } from "../config.js";

export interface EmbeddingClient {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

const MAX_BATCH_SIZE = 100;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown): boolean {
  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    return status === 429 || (status !== undefined && status >= 500);
  }
  return false;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class OpenAIEmbeddingClient implements EmbeddingClient {
  private client: OpenAI;
  private model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }
    this.model = opts?.model ?? EMBEDDING_MODEL;
    this.client = new OpenAI({ apiKey });
  }

  async embed(text: string): Promise<number[]> {
    const [vec] = await this.embedBatch([text]);
    if (!vec) throw new Error("embed returned no vector");
    return vec;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    for (let i = 0; i < texts.length; i++) {
      if (texts[i]!.trim().length === 0) {
        throw new Error(`text at index ${i} is empty`);
      }
    }

    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE);
      const vectors = await this.embedWithRetry(batch);
      results.push(...vectors);
    }

    return results;
  }

  private async embedWithRetry(batch: string[]): Promise<number[][]> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.embeddings.create({
          model: this.model,
          input: batch,
        });
        const sorted = [...response.data].sort((a, b) => a.index - b.index);
        return sorted.map((d) => d.embedding);
      } catch (error) {
        lastError = error;
        if (attempt === MAX_RETRIES || !isRetryable(error)) {
          throw error;
        }
        const delay = BASE_DELAY_MS * 2 ** attempt + Math.random() * 200;
        await sleep(delay);
      }
    }

    throw lastError;
  }
}
