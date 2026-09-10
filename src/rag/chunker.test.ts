import { describe, it, expect } from "vitest";
import { chunkText } from "./chunker.js";

describe("chunker", () => {
  it("Empty input returns empty array", () => {
    expect(chunkText([])).toEqual([]);
  });

  it("Single short paragraph produces one chunk", () => {
    const pages = [{ pageNumber: 1, text: "Hello world" }];
    const chunks = chunkText(pages);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("Hello world");
    expect(chunks[0].pageStart).toBe(1);
    expect(chunks[0].pageEnd).toBe(1);
  });

  it("Long text exceeding maxTokens is split into multiple chunks", () => {
    const longText = Array(1000).fill("word.").join(" ");
    const pages = [{ pageNumber: 1, text: longText }];
    const chunks = chunkText(pages, { maxTokens: 100, overlapTokens: 20 });
    
    expect(chunks.length).toBeGreaterThan(1);
    // overlap
    expect(chunks[0].content).not.toEqual(chunks[1].content);
  });

  it("Heading detection: markdown headings", () => {
    const text = "# Main Heading\nSome text\n## Sub Heading\nMore text";
    const pages = [{ pageNumber: 1, text }];
    const chunks = chunkText(pages, { maxTokens: 50 });
    
    // Check that breadcrumbs are prepended
    expect(chunks[0].content).toContain("Main Heading");
  });
});
