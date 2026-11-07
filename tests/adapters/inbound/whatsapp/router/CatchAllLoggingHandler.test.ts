import { describe, it, expect, vi } from "vitest";
import { CatchAllLoggingHandler } from "../../../../../src/adapters/inbound/whatsapp/router/CatchAllLoggingHandler";
import { NormalizedWhatsAppMessage } from "../../../../../src/adapters/inbound/whatsapp/router/NormalizedWhatsAppMessage";

describe("CatchAllLoggingHandler", () => {
	const createMockLogger = () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis(),
	});

	it("matches any normalized WhatsApp message", () => {
		const logger = createMockLogger();
		const handler = new CatchAllLoggingHandler(logger);
		const message = { messageId: "msg-1" } as NormalizedWhatsAppMessage;
		expect(handler.matches(message)).toBe(true);
	});

	it("logs unhandled message at info level with content preview and rawKeys for unsupported type", async () => {
		const logger = createMockLogger();
		const handler = new CatchAllLoggingHandler(logger);

		const message: NormalizedWhatsAppMessage = {
			messageId: "unhandled-msg-id",
			chatJid: "120363413801802358@g.us",
			chatType: "group",
			senderJid: "202898550042793@lid",
			senderType: "lid",
			companionLidJid: null,
			fromMe: false,
			upsertType: "notify",
			originalTimestamp: 1727223000000,
			timestamp: 1727223000000,
			content: {
				type: "unsupported",
				text: null,
				mimeType: null,
				preview: "[unsupported: groupMentionedMessage]",
				rawKeys: ["groupMentionedMessage"],
			},
			downloadMedia: vi.fn().mockResolvedValue(null),
		};

		await handler.handle(message);

		expect(logger.info).toHaveBeenCalledWith(
			"Unhandled incoming message ignored by catch-all fallback",
			{
				messageId: "unhandled-msg-id",
				chatJid: "120363413801802358@g.us",
				senderJid: "202898550042793@lid",
				chatType: "group",
				contentType: "unsupported",
				contentPreview: "[unsupported: groupMentionedMessage]",
				rawKeys: ["groupMentionedMessage"],
				fromMe: false,
				upsertType: "notify",
			},
		);
		expect(logger.debug).not.toHaveBeenCalled();
	});

	it("logs unhandled supported message without rawKeys at info level", async () => {
		const logger = createMockLogger();
		const handler = new CatchAllLoggingHandler(logger);

		const message: NormalizedWhatsAppMessage = {
			messageId: "unhandled-text-id",
			chatJid: "120363999999999999@g.us",
			chatType: "group",
			senderJid: "919876543210@s.whatsapp.net",
			senderType: "pn",
			companionLidJid: null,
			fromMe: false,
			upsertType: "notify",
			originalTimestamp: 1727223000000,
			timestamp: 1727223000000,
			content: {
				type: "text",
				text: "Random chat message in irrelevant group",
				mimeType: null,
				preview: "Random chat message in irrelevant group",
			},
			downloadMedia: vi.fn().mockResolvedValue(null),
		};

		await handler.handle(message);

		expect(logger.info).toHaveBeenCalledWith(
			"Unhandled incoming message ignored by catch-all fallback",
			{
				messageId: "unhandled-text-id",
				chatJid: "120363999999999999@g.us",
				senderJid: "919876543210@s.whatsapp.net",
				chatType: "group",
				contentType: "text",
				contentPreview: "Random chat message in irrelevant group",
				rawKeys: undefined,
				fromMe: false,
				upsertType: "notify",
			},
		);
	});
});
