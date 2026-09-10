import { describe, it, expect, vi } from "vitest";
import { getMessageText } from "./messageText.js";
import { extractMessageContent, getContentType } from "@whiskeysockets/baileys";

vi.mock("@whiskeysockets/baileys", () => ({
  extractMessageContent: vi.fn(),
  getContentType: vi.fn(),
}));

describe("getMessageText", () => {
  it("returns undefined for null or undefined message", () => {
    expect(getMessageText(null as any)).toBeUndefined();
    expect(getMessageText(undefined as any)).toBeUndefined();
  });

  it("extracts text from conversation message type", () => {
    vi.mocked(extractMessageContent).mockReturnValue({ conversation: "Hello World" });
    vi.mocked(getContentType).mockReturnValue("conversation" as any);

    expect(getMessageText({} as any)).toBe("Hello World");
  });

  it("extracts text from extendedTextMessage type", () => {
    vi.mocked(extractMessageContent).mockReturnValue({ extendedTextMessage: { text: "Extended Hello" } });
    vi.mocked(getContentType).mockReturnValue("extendedTextMessage" as any);

    expect(getMessageText({} as any)).toBe("Extended Hello");
  });

  it("returns undefined for unknown message types (e.g., imageMessage)", () => {
    vi.mocked(extractMessageContent).mockReturnValue({ imageMessage: { url: "http://example.com" } });
    vi.mocked(getContentType).mockReturnValue("imageMessage" as any);

    expect(getMessageText({} as any)).toBeUndefined();
  });

  it("returns undefined for message with no content in conversation", () => {
    vi.mocked(extractMessageContent).mockReturnValue({});
    vi.mocked(getContentType).mockReturnValue("conversation" as any);

    expect(getMessageText({} as any)).toBeUndefined();
  });
});
