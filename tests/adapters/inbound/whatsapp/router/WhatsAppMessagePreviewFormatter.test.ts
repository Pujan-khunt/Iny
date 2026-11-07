import { describe, it, expect } from "vitest";
import { WhatsAppMessagePreviewFormatter } from "../../../../../src/adapters/inbound/whatsapp/router/WhatsAppMessagePreviewFormatter";

describe("WhatsAppMessagePreviewFormatter", () => {
	it("formats short text message with normalized whitespace", () => {
		const result = WhatsAppMessagePreviewFormatter.formatText("Hello,\nworld!   How are   you?");
		expect(result).toBe("Hello, world! How are you?");
	});

	it("truncates text messages exceeding 500 characters", () => {
		const longText = "A".repeat(600);
		const result = WhatsAppMessagePreviewFormatter.formatText(longText);
		expect(result).toHaveLength(500 + " ... [truncated]".length);
		expect(result.startsWith("A".repeat(500))).toBe(true);
		expect(result.endsWith(" ... [truncated]")).toBe(true);
	});

	it("preserves exact text of exactly 500 characters without truncation suffix", () => {
		const exactText = "B".repeat(500);
		const result = WhatsAppMessagePreviewFormatter.formatText(exactText);
		expect(result).toBe(exactText);
	});

	it("formats image preview with caption", () => {
		const result = WhatsAppMessagePreviewFormatter.formatImage("Special lunch menu", "image/jpeg");
		expect(result).toBe("Special lunch menu (image/jpeg)");
	});

	it("formats image preview without caption", () => {
		const result = WhatsAppMessagePreviewFormatter.formatImage(null, "image/png");
		expect(result).toBe("[image without caption] (image/png)");
	});

	it("formats document preview with fileName and caption", () => {
		const result = WhatsAppMessagePreviewFormatter.formatDocument(
			"Weekly Mess Schedule",
			"menu.pdf",
			"application/pdf",
		);
		expect(result).toBe("[document: menu.pdf] Weekly Mess Schedule (application/pdf)");
	});

	it("formats document preview with only fileName", () => {
		const result = WhatsAppMessagePreviewFormatter.formatDocument(
			null,
			"menu.pdf",
			"application/pdf",
		);
		expect(result).toBe("[document: menu.pdf] (application/pdf)");
	});

	it("formats document preview without fileName or caption", () => {
		const result = WhatsAppMessagePreviewFormatter.formatDocument(null, null, "application/pdf");
		expect(result).toBe("[document] (application/pdf)");
	});

	it("extracts rawKeys and formats preview for unsupported message", () => {
		const rawMessage = {
			groupMentionedMessage: { message: {} },
			messageContextInfo: {},
		};
		const { preview, rawKeys } = WhatsAppMessagePreviewFormatter.formatUnsupported(rawMessage);
		expect(rawKeys).toEqual(["groupMentionedMessage", "messageContextInfo"]);
		expect(preview).toBe("[unsupported: groupMentionedMessage, messageContextInfo]");
	});

	it("handles empty or null raw message for unsupported payloads", () => {
		const { preview, rawKeys } = WhatsAppMessagePreviewFormatter.formatUnsupported(null);
		expect(rawKeys).toEqual([]);
		expect(preview).toBe("[unsupported: empty]");
	});
});
