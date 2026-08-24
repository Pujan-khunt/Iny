import { db } from "../db/index.js";
import { chunks, documents } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { OpenAIEmbeddingClient } from "../embeddings/client.js";
import { SIMILARITY_THRESHOLD, TOP_K } from "../config.js";

export interface RetrievedChunk {
  content: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  score: number;
}

export async function retrieveTopK(
  query: string,
  opts: { topK?: number; threshold?: number } = {}
): Promise<RetrievedChunk[]> {
  const topK = opts.topK ?? TOP_K;
  const threshold = opts.threshold ?? SIMILARITY_THRESHOLD;

  const client = new OpenAIEmbeddingClient();
  const vectors = await client.embedBatch([query]);
  const queryVector = vectors[0]!;
  const vectorString = `[${queryVector.join(",")}]`;

  const results = await db
    .select({
      content: chunks.content,
      title: documents.title,
      pageStart: chunks.pageStart,
      pageEnd: chunks.pageEnd,
      score: sql<number>`1 - (${chunks.embedding} <=> ${vectorString}::vector)`.as("score"),
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(eq(chunks.sourceType, "document"))
    .orderBy(sql`${chunks.embedding} <=> ${vectorString}::vector`)
    .limit(topK);

  return results
    .filter((r) => r.score >= threshold)
    .map((r) => ({
      content: r.content,
      title: r.title,
      pageStart: r.pageStart,
      pageEnd: r.pageEnd,
      score: r.score,
    }));
}