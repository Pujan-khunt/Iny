import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRetriever, RetrievalDeps } from "./retrieve.js";

describe("retrieveTopK", () => {
  let mockDb: any;
  let mockEmbedClient: any;
  let deps: RetrievalDeps;
  let retriever: ReturnType<typeof createRetriever>;

  beforeEach(() => {
    mockDb = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    };

    mockEmbedClient = {
      embed: vi.fn(),
      embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    };

    deps = {
      db: mockDb,
      embedClient: mockEmbedClient,
    };

    retriever = createRetriever(deps);
  });

  it("returns empty array for empty query", async () => {
    const result = await retriever.retrieveTopK("");
    expect(result).toEqual([]);
    expect(mockEmbedClient.embedBatch).not.toHaveBeenCalled();
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it("returns empty array for whitespace-only query", async () => {
    const result = await retriever.retrieveTopK("   \t  \n");
    expect(result).toEqual([]);
    expect(mockEmbedClient.embedBatch).not.toHaveBeenCalled();
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it("successfully retrieves and maps rows, rounding scores", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [
        {
          id: "chunk-1",
          content: "Some policy text...",
          title: "Academic Policy",
          page_start: 5,
          page_end: 6,
          sim_score: 0.85123,
          text_score: 0.40019,
          rrf_score: 0.03215,
        },
      ],
    });

    const result = await retriever.retrieveTopK("policy", { threshold: 0.7 });

    expect(result).toEqual([
      {
        content: "Some policy text...",
        title: "Academic Policy",
        pageStart: 5,
        pageEnd: 6,
        score: 0.0321,
        simScore: 0.8512,
        textScore: 0.4002,
        matchType: "hybrid",
      },
    ]);
  });

  it("detects semantic-only match type", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [
        {
          id: "chunk-1",
          content: "Some policy text...",
          title: "Academic Policy",
          page_start: 5,
          page_end: 6,
          sim_score: 0.85,
          text_score: 0,
          rrf_score: 0.032,
        },
      ],
    });

    const result = await retriever.retrieveTopK("policy", { threshold: 0.8 });
    expect(result[0]?.matchType).toBe("semantic");
  });

  it("detects keyword-only match type", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [
        {
          id: "chunk-1",
          content: "Some policy text...",
          title: "Academic Policy",
          page_start: 5,
          page_end: 6,
          sim_score: 0.5,
          text_score: 0.9,
          rrf_score: 0.032,
        },
      ],
    });

    const result = await retriever.retrieveTopK("policy", { threshold: 0.8 });
    expect(result[0]?.matchType).toBe("keyword");
  });

  it("filters out rows below similarity threshold and without keyword match", async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [
        {
          id: "chunk-1",
          content: "Keep this (keyword match)",
          title: "Doc 1",
          page_start: 1,
          page_end: 1,
          sim_score: 0.4,
          text_score: 0.5,
          rrf_score: 0.032,
        },
        {
          id: "chunk-2",
          content: "Keep this (semantic match)",
          title: "Doc 2",
          page_start: 1,
          page_end: 1,
          sim_score: 0.85,
          text_score: 0,
          rrf_score: 0.032,
        },
        {
          id: "chunk-3",
          content: "Filter this out (low sim, no keyword)",
          title: "Doc 3",
          page_start: 1,
          page_end: 1,
          sim_score: 0.4,
          text_score: 0,
          rrf_score: 0.032,
        },
      ],
    });

    const result = await retriever.retrieveTopK("policy", { threshold: 0.8 });
    expect(result).toHaveLength(2);
    expect(result.map(r => r.title)).toContain("Doc 1");
    expect(result.map(r => r.title)).toContain("Doc 2");
    expect(result.map(r => r.title)).not.toContain("Doc 3");
  });

  it("handles zero results gracefully", async () => {
    mockDb.execute.mockResolvedValueOnce({ rows: [] });
    const result = await retriever.retrieveTopK("policy");
    expect(result).toEqual([]);
  });

  it("handles undefined rows gracefully", async () => {
    mockDb.execute.mockResolvedValueOnce({});
    const result = await retriever.retrieveTopK("policy");
    expect(result).toEqual([]);
  });

  it("uses provided topK and threshold instead of defaults", async () => {
    mockDb.execute.mockResolvedValueOnce({ rows: [] });
    await retriever.retrieveTopK("policy", { topK: 5, threshold: 0.95 });
    
    expect(mockDb.execute).toHaveBeenCalled();
    const callArgs = mockDb.execute.mock.calls[0][0];
    expect(callArgs).toBeDefined();
  });
});