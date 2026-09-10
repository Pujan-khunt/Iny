import { describe, it, expect, vi } from "vitest";
import { ingestFile } from "./ingest.js";
import { parseFile } from "./parser.js";
import { chunkText } from "./chunker.js";
import { OpenAIEmbeddingClient } from "../embeddings/client.js";
import { db } from "../db/index.js";

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn(),
    delete: vi.fn().mockReturnThis(),
    transaction: vi.fn(async (cb) => cb(db)),
  },
}));
vi.mock("../db/schema.js", () => ({ documents: {}, chunks: {} }));
vi.mock("./parser.js", () => ({ parseFile: vi.fn() }));
vi.mock("./chunker.js", () => ({ chunkText: vi.fn() }));
vi.mock("../embeddings/client.js", () => {
  return {
    OpenAIEmbeddingClient: class {
      embedBatch = vi.fn().mockResolvedValue([[0.1, 0.2]]);
    }
  };
});

describe("ingestFile", () => {
  it("skips ingestion when content hash already exists in DB", async () => {
    vi.mocked(db.limit).mockResolvedValueOnce([{ id: "existing-id" }] as any);
    const res = await ingestFile("path", Buffer.from("test"), { maxTokens: 100, overlapTokens: 10, sourceType: "document" });
    expect(res.docId).toBe("existing-id");
    expect(res.chunksCreated).toBe(0);
  });

  it("parses file, chunks text, generates embeddings, inserts into DB", async () => {
    vi.mocked(db.limit).mockResolvedValueOnce([] as any);
    vi.mocked(parseFile).mockResolvedValueOnce({ title: "Title", pages: ["page 1"] } as any);
    vi.mocked(chunkText).mockReturnValueOnce([{ content: "chunk 1", tokenCount: 10, pageStart: 1, pageEnd: 1 }] as any);
    const res = await ingestFile("path", Buffer.from("test"), { maxTokens: 100, overlapTokens: 10, sourceType: "document" });
    expect(res.chunksCreated).toBe(1);
    expect(res.tokens).toBe(10);
    expect(res.costUsd).toBe((10 / 1_000_000) * 0.02);
  });

  it("returns zero chunks when chunkText returns empty", async () => {
    vi.mocked(db.limit).mockResolvedValueOnce([] as any);
    vi.mocked(parseFile).mockResolvedValueOnce({ title: "Title", pages: [] } as any);
    vi.mocked(chunkText).mockReturnValueOnce([] as any);
    const res = await ingestFile("path", Buffer.from("test"), { maxTokens: 100, overlapTokens: 10, sourceType: "document" });
    expect(res.chunksCreated).toBe(0);
  });
});
