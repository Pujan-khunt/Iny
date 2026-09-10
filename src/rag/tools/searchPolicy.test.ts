import { describe, it, expect, vi, beforeEach } from "vitest";
import { SearchPolicyTool } from "./searchPolicy.js";
import { retrieveTopK } from "../retrieve.js";

vi.mock("../retrieve.js", () => ({
  retrieveTopK: vi.fn(),
}));

describe("SearchPolicyTool", () => {
  const tool = new SearchPolicyTool();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Returns success with formatted results when chunks found", async () => {
    (retrieveTopK as any).mockResolvedValue([
      { content: "chunk 1", title: "Doc A", pageStart: 1, pageEnd: 1 },
      { content: "chunk 2", title: "Doc B", pageStart: 2, pageEnd: 3, matchType: "exact" }
    ]);
    const res = await tool.execute({ query: "test" });
    const content = JSON.parse(res.content);
    expect(content.success).toBe(true);
    expect(content.results).toHaveLength(2);
    expect(content.results[0].source).toBe("Doc A");
    expect(res.chunks).toHaveLength(2);
  });

  it("Returns failure message when no chunks found", async () => {
    (retrieveTopK as any).mockResolvedValue([]);
    const res = await tool.execute({ query: "test" });
    const content = JSON.parse(res.content);
    expect(content.success).toBe(false);
    expect(content.message).toContain("No matching documents found");
  });

  it("Truncates chunk content to MAX_CHUNK_CONTENT_CHARS", async () => {
    const longContent = "A".repeat(5000);
    (retrieveTopK as any).mockResolvedValue([
      { content: longContent, title: "Doc", pageStart: 1, pageEnd: 1 }
    ]);
    const res = await tool.execute({ query: "test" });
    const content = JSON.parse(res.content);
    expect(content.results[0].content.length).toBeLessThan(5000);
    expect(content.results[0].content.endsWith("…")).toBe(true);
  });

  it("Handles errors from retrieveTopK gracefully", async () => {
    (retrieveTopK as any).mockRejectedValue(new Error("DB error"));
    const res = await tool.execute({ query: "test" });
    const content = JSON.parse(res.content);
    expect(content.success).toBe(false);
    expect(content.message).toContain("DB error");
  });

  it("Verify the tool name, description, and parameters schema", () => {
    expect(tool.name).toBe("search_knowledge_base");
    expect(tool.description).toContain("Search the SST college knowledge base");
    expect(tool.parameters.properties.query).toBeDefined();
  });
});
