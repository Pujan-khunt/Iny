import { describe, it, expect } from "vitest";
import { convertMarkdownToWhatsApp } from "../../src/utils/markdown.js";

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
});
