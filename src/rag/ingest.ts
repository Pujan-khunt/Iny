import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { parsePdf } from "./parser.js";
import { chunkText } from "./chunker.js";
import { OpenAIEmbeddingClient } from "../embeddings/client.js";
import { db } from "../db/index.js";
import { documents, chunks } from "../db/schema.js";
import { eq } from "drizzle-orm";

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
  opts: IngestOptions
): Promise<IngestResult> {
  const contentHash = createHash("sha256").update(buffer).digest("hex");

  const existing = await db.select().from(documents).where(eq(documents.contentHash, contentHash)).limit(1);
  if (existing.length > 0) {
    return { docId: existing[0]!.id, chunksCreated: 0, tokens: 0, costUsd: 0 };
  }

  const { title, pages } = await parsePdf(buffer);

  const chunksData = chunkText(pages, { maxTokens: opts.maxTokens, overlapTokens: opts.overlapTokens });

  if (chunksData.length === 0) {
    return { docId: "", chunksCreated: 0, tokens: 0, costUsd: 0 };
  }

  const client = new OpenAIEmbeddingClient();
  const vectors = await client.embedBatch(chunksData.map((c) => c.content));

  const docId = randomUUID();

  await db.transaction(async (tx) => {
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
      }))
    );
  });

  const totalTokens = chunksData.reduce((s, c) => s + c.tokenCount, 0);
  const costUsd = (totalTokens / 1_000_000) * EMBEDDING_COST_PER_MILLION;

  return { docId, chunksCreated: chunksData.length, tokens: totalTokens, costUsd };
}
