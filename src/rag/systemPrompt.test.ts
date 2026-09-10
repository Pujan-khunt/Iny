import { describe, it, expect } from "vitest";
import { getSystemPrompt, BASE_SYSTEM_PROMPT, STYLE_PROMPTS } from "./systemPrompt.js";

describe("systemPrompt", () => {
  it("Default style includes base prompt + concise style", () => {
    const prompt = getSystemPrompt();
    expect(prompt).toContain(BASE_SYSTEM_PROMPT);
    expect(prompt).toContain(STYLE_PROMPTS.concise);
  });

  it("'detailed' style includes detailed style block", () => {
    const prompt = getSystemPrompt("detailed");
    expect(prompt).toContain(STYLE_PROMPTS.detailed);
  });

  it("'to-the-point' style works", () => {
    const prompt = getSystemPrompt("to-the-point");
    expect(prompt).toContain(STYLE_PROMPTS["to-the-point"]);
  });

  it("Custom style prompt overrides style selection", () => {
    const prompt = getSystemPrompt("detailed", "My custom style");
    expect(prompt).toContain("My custom style");
    expect(prompt).not.toContain(STYLE_PROMPTS.detailed);
  });

  it("Empty custom style prompt falls back to default", () => {
    const prompt = getSystemPrompt(undefined, "   ");
    expect(prompt).toContain(STYLE_PROMPTS.concise);
  });

  it("Unknown style falls back to concise", () => {
    const prompt = getSystemPrompt("made-up-style");
    expect(prompt).toContain(STYLE_PROMPTS.concise);
  });
  
  it("exports constants", () => {
    expect(BASE_SYSTEM_PROMPT).toBeDefined();
    expect(STYLE_PROMPTS).toBeDefined();
  });
});
