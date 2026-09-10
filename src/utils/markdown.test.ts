import { describe, it, expect } from "vitest";
import { convertMarkdownToWhatsApp } from "./markdown.js";

describe("Markdown to WhatsApp Converter", () => {
  it("converts bold text", () => {
    const input = "This is **bold** text and __also bold__.";
    const expected = "This is *bold* text and *also bold*.";
    expect(convertMarkdownToWhatsApp(input)).toBe(expected);
  });

  it("converts italics and bold combinations", () => {
    const input = "This is ***bold and italic***.";
    const expected = "This is *_bold and italic_*.";
    expect(convertMarkdownToWhatsApp(input)).toBe(expected);
  });

  it("converts headers to bold text", () => {
    const input = "### Subheader\nSome text";
    const expected = "*Subheader*\nSome text";
    expect(convertMarkdownToWhatsApp(input)).toBe(expected);
  });

  it("converts markdown links to text + URL", () => {
    const input = "Check out [Scaler](https://scaler.com) for more.";
    const expected = "Check out *Scaler* (https://scaler.com) for more.";
    expect(convertMarkdownToWhatsApp(input)).toBe(expected);
  });

  it("protects code blocks from markdown transformation", () => {
    const input = "Here is code:\n```javascript\nconst a = **bold**;\n```";
    const expected = "Here is code:\n```\nconst a = **bold**;\n```";
    expect(convertMarkdownToWhatsApp(input)).toBe(expected);
  });

  it("converts table to mobile-friendly format", () => {
    const input = `| Col 1 | Col 2 |\n|---|---|\n| Val 1 | Val 2 |`;
    const expected = `• *Col 1:* Val 1  |  *Col 2:* Val 2`;
    expect(convertMarkdownToWhatsApp(input)).toBe(expected);
  });

  it("converts horizontal rule", () => {
    const input = "Some text\n---\nMore text";
    const expected = "Some text\n────────────────\nMore text";
    expect(convertMarkdownToWhatsApp(input)).toBe(expected);
  });

  it("converts unordered list", () => {
    const input = "* item 1\n- item 2\n+ item 3";
    const expected = "• item 1\n• item 2\n• item 3";
    expect(convertMarkdownToWhatsApp(input)).toBe(expected);
  });

  it("converts nested indent list items", () => {
    const input = "* item 1\n  * item 2";
    const expected = "• item 1\n   • item 2";
    expect(convertMarkdownToWhatsApp(input)).toBe(expected);
  });

  it("converts strikethrough", () => {
    expect(convertMarkdownToWhatsApp("~~striked~~")).toBe("~striked~");
  });

  it("normalizes multiple consecutive blank lines", () => {
    expect(convertMarkdownToWhatsApp("A\n\n\n\nB")).toBe("A\n\nB");
  });

  it("protects URLs in transformed text", () => {
    expect(convertMarkdownToWhatsApp("Visit https://example.com/a_b_c")).toBe("Visit https://example.com/a_b_c");
  });

  it("protects inline code", () => {
    expect(convertMarkdownToWhatsApp("Use `const a = **bold**`")).toBe("Use `const a = **bold**`");
  });

  it("returns empty string for empty input", () => {
    expect(convertMarkdownToWhatsApp("")).toBe("");
  });

  it("handles mixed formatting", () => {
    const input = "This is ***bold and italic*** and `code`";
    const expected = "This is *_bold and italic_* and `code`";
    expect(convertMarkdownToWhatsApp(input)).toBe(expected);
  });
});
