import { createHash, randomUUID } from "node:crypto";
import { parsePdf } from "./parser.js";
import { chunkText } from "./chunker.js";
import { OpenAIEmbeddingClient } from "../embeddings/client.js";
import { db } from "../db/index.js";
import { documents, chunks } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

export type SourceType = "document" | "whatsapp";

export interface IngestOptions {
  maxTokens: number;
  overlapTokens: number;
  sourceType: SourceType;
}

export interface IngestResult {
  docId: string;
  chunksCreated: number;
  tokens: number;
  costUsd: number;
}

const EMBEDDING_COST_PER_MILLION = 0.02;

export async function ingestFile(
  filePath: string,
  buffer: Buffer,
  opts: IngestOptions,
): Promise<IngestResult> {
  const contentHash = createHash("sha256").update(buffer).digest("hex");

  // 1. Check if exact document content is already ingested
  const existingByHash = await db
    .select()
    .from(documents)
    .where(eq(documents.contentHash, contentHash))
    .limit(1);

  if (existingByHash.length > 0) {
    return { docId: existingByHash[0]!.id, chunksCreated: 0, tokens: 0, costUsd: 0 };
  }

  // 2. Parse PDF and extract formatted title + true page splits
  const { title, pages } = await parsePdf(buffer, filePath);

  const chunksData = chunkText(pages, {
    maxTokens: opts.maxTokens,
    overlapTokens: opts.overlapTokens,
  });

  if (chunksData.length === 0) {
    return { docId: "", chunksCreated: 0, tokens: 0, costUsd: 0 };
  }

  // 3. Generate embeddings
  const client = new OpenAIEmbeddingClient();
  const vectors = await client.embedBatch(chunksData.map((c) => c.content));

  const docId = randomUUID();

  // 4. Atomic Transaction: Replace old document version if updated and insert new chunks
  await db.transaction(async (tx) => {
    // If a document with this sourcePath already exists (updated policy), remove the old version
    if (opts.sourceType === "document" && filePath) {
      await tx.delete(documents).where(eq(documents.sourcePath, filePath));
    }

    await tx.insert(documents).values({
      id: docId,
      title,
      sourcePath: opts.sourceType === "document" ? filePath : "",
      contentHash,
      sourceType: opts.sourceType,
    });

    await tx.insert(chunks).values(
      chunksData.map((c, i) => ({
        id: randomUUID(),
        documentId: docId,
        content: c.content,
        chunkIndex: i,
        tokenCount: c.tokenCount,
        embedding: vectors[i]!,
        sourceType: opts.sourceType,
        pageStart: c.pageStart,
        pageEnd: c.pageEnd,
      })),
    );
  });

  const totalTokens = chunksData.reduce((s, c) => s + c.tokenCount, 0);
  const costUsd = (totalTokens / 1_000_000) * EMBEDDING_COST_PER_MILLION;

  return { docId, chunksCreated: chunksData.length, tokens: totalTokens, costUsd };
}
