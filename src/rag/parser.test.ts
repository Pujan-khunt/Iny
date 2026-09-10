import { describe, it, expect } from "vitest";
import { formatTitleFromFilename, parseMarkdown, parseFile } from "./parser.js";

describe("parser", () => {
  describe("formatTitleFromFilename", () => {
    it("handles kebab-case and snake_case", () => {
      expect(formatTitleFromFilename("my-cool-doc.md")).toBe("My Cool Doc");
      expect(formatTitleFromFilename("some_other_doc.md")).toBe("Some Other Doc");
    });
    
    it("preserves known acronyms", () => {
      expect(formatTitleFromFilename("sst-sop-guidelines.md")).toBe("SST SOP Guidelines");
    });
    
    it("strips directory paths and .md extension", () => {
      expect(formatTitleFromFilename("/path/to/some/file/my-doc.md")).toBe("My Doc");
    });
    
    it("keeps small words lowercase", () => {
      expect(formatTitleFromFilename("how-to-do-it.md")).toBe("How to Do It");
    });
  });

  describe("parseMarkdown", () => {
    it("extracts H1 title and falls back to filename", async () => {
      const content = "# My Main Title\n\nSome text.";
      expect((await parseMarkdown(Buffer.from(content), "default-title")).title).toBe("My Main Title");
      
      const noH1 = "Just some text without heading.";
      expect((await parseMarkdown(Buffer.from(noH1), "Default Title")).title).toBe("Default Title");
    });
    
    it("normalizes text", async () => {
      const content = "Line 1\r\nLine 2\n\n\nLine 3";
      expect((await parseMarkdown(Buffer.from(content), "Title")).pages[0].text).toBe("Line 1\nLine 2\n\nLine 3");
    });
  });

  describe("parseFile", () => {
    it("rejects non-.md files", async () => {
      await expect(parseFile("test.pdf", Buffer.from("test"))).rejects.toThrow(/Only Markdown.*supported/);
    });
  });
});
