import { describe, it, expect } from "vitest";
import { isAskingForSources, formatSourcesForWhatsApp } from "./formatSources.js";
import type { RetrievedChunk } from "../core/index.js";

describe("formatSources", () => {
  describe("isAskingForSources", () => {
    it("matches source-related questions", () => {
      expect(isAskingForSources("show me the sources")).toBe(true);
      expect(isAskingForSources("where did you get this")).toBe(true);
      expect(isAskingForSources("what is the source")).toBe(true);
      expect(isAskingForSources("citations please")).toBe(true);
    });
    
    it("does NOT match normal questions", () => {
      expect(isAskingForSources("what is the policy")).toBe(false);
      expect(isAskingForSources("tell me about the rules")).toBe(false);
    });

    it("empty string returns false", () => {
      expect(isAskingForSources("")).toBe(false);
      expect(isAskingForSources("   ")).toBe(false);
    });
  });

  describe("formatSourcesForWhatsApp", () => {
    it("formats citations with title, pages, preview", () => {
      // Create a mock chunk satisfying RetrievedChunk as needed for testing
      const chunks: any[] = [
        {
          content: "This is a preview text that is long enough to be shown in the citation.",
          title: "The Policy Doc",
          pageStart: 1,
          pageEnd: 2,
        }
      ];
      const formatted = formatSourcesForWhatsApp(chunks as RetrievedChunk[]);
      expect(formatted).toContain("*The Policy Doc*");
      expect(formatted).toContain("Pages: pp. 1-2");
    });

    it("empty chunks returns 'No sources available'", () => {
      expect(formatSourcesForWhatsApp([])).toBe("No sources available for this response.");
    });
  });
});
