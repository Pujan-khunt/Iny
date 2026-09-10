import { describe, it, expect, beforeEach } from "vitest";
import { createSourceCacheStore, buildCitations } from "./sources.js";
import type { SourceCacheStore } from "./sources.js";

describe("SourceCacheStore", () => {
  let store: SourceCacheStore;

  beforeEach(() => {
    store = createSourceCacheStore({ ttlMs: 1000 });
  });

  it("cacheSources stores and getSources retrieves", () => {
    const chunks = [
      { id: "1", title: "Doc", content: "hello", pageStart: 1, pageEnd: 1 }
    ];
    store.cacheSources("session-1", chunks as any);
    expect(store.getSources("session-1")).toEqual(chunks);
  });

  it("clearSources removes cached data", () => {
    const chunks = [
      { id: "1", title: "Doc", content: "hello", pageStart: 1, pageEnd: 1 }
    ];
    store.cacheSources("session-1", chunks as any);
    store.clearSources("session-1");
    expect(store.getSources("session-1")).toEqual([]);
  });

  it("Multiple sessions are independent", () => {
    const chunks1 = [{ id: "1", title: "Doc1", content: "hello", pageStart: 1, pageEnd: 1 }];
    const chunks2 = [{ id: "2", title: "Doc2", content: "world", pageStart: 1, pageEnd: 1 }];
    store.cacheSources("s1", chunks1 as any);
    store.cacheSources("s2", chunks2 as any);
    expect(store.getSources("s1")).toEqual(chunks1);
    expect(store.getSources("s2")).toEqual(chunks2);
  });
});

describe("buildCitations", () => {
  it("buildCitations with empty input returns []", () => {
    expect(buildCitations([])).toEqual([]);
  });

  it("buildCitations groups by title, computes page ranges", () => {
    const chunks = [
      { id: "1", title: "Doc1", content: "part 1", pageStart: 2, pageEnd: 2 },
      { id: "2", title: "Doc1", content: "part 2", pageStart: 5, pageEnd: 6 },
      { id: "3", title: "Doc2", content: "part 3", pageStart: 1, pageEnd: 1 }
    ];
    const citations = buildCitations(chunks as any);
    expect(citations.length).toBe(2);
    expect(citations[0].title).toBe("Doc1");
    expect(citations[0].pageStart).toBe(2);
    expect(citations[0].pageEnd).toBe(6);
    expect(citations[0].pageString).toContain("p. 2");
    expect(citations[0].pageString).toContain("pp. 5-6");
    
    expect(citations[1].title).toBe("Doc2");
    expect(citations[1].pageStart).toBe(1);
    expect(citations[1].pageEnd).toBe(1);
    expect(citations[1].pageString).toBe("p. 1");
  });

  it("buildCitations preview truncation", () => {
    const longContent = "A".repeat(200);
    const chunks = [
      { id: "1", title: "Doc1", content: longContent, pageStart: 1, pageEnd: 1 }
    ];
    const citations = buildCitations(chunks as any);
    expect(citations[0].preview.length).toBeLessThanOrEqual(153); // 150 + "..."
    expect(citations[0].preview.endsWith("...")).toBe(true);
  });

  it("buildCitations page string formatting (single page vs range)", () => {
    const chunks = [
      { id: "1", title: "Doc1", content: "A", pageStart: 3, pageEnd: 3 },
      { id: "2", title: "Doc2", content: "B", pageStart: 4, pageEnd: 7 }
    ];
    const citations = buildCitations(chunks as any);
    expect(citations.find(c => c.title === "Doc1")?.pageString).toBe("p. 3");
    expect(citations.find(c => c.title === "Doc2")?.pageString).toBe("pp. 4-7");
  });
});
