import { describe, it, expect, vi } from "vitest";
import { WhatsAppMessageNormalizer } from "../../../../../src/adapters/inbound/whatsapp/router/WhatsAppMessageNormalizer";
import { WhatsAppMessageContentExtractor } from "../../../../../src/adapters/inbound/whatsapp/router/WhatsAppMessageContentExtractor";
import {
	NormalizedWhatsAppMessage,
	WhatsAppMessageHandler,
} from "../../../../../src/adapters/inbound/whatsapp/router/NormalizedWhatsAppMessage";
import { WAMessage } from "@whiskeysockets/baileys";

describe("WhatsAppMessageNormalizer", () => {
	const mockLogger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis(),
	};
	const contentExtractor = new WhatsAppMessageContentExtractor(mockLogger);
	const normalizer = new WhatsAppMessageNormalizer(mockLogger, contentExtractor);

	it("returns null for malformed message missing key or id", () => {
		expect(normalizer.normalize({} as any)).toBeNull();
		expect(normalizer.normalize({ key: {} } as any)).toBeNull();
		expect(normalizer.normalize({ key: { id: "msg-1" } } as any)).toBeNull();
	});

	it("normalizes direct text message with sender and companion LID resolution", () => {
		const raw: WAMessage = {
			key: {
				id: "msg-1",
				remoteJid: "919876543210@s.whatsapp.net",
				remoteJidAlt: "123456789012345@lid",
				fromMe: false,
			},
			message: { conversation: "Hello Iny" },
			messageTimestamp: 1727223000,
		};
		const result = normalizer.normalize(raw);
		expect(result).not.toBeNull();
		expect(result?.messageId).toBe("msg-1");
		expect(result?.chatJid).toBe("919876543210@s.whatsapp.net");
		expect(result?.chatType).toBe("direct");
		expect(result?.senderJid).toBe("919876543210@s.whatsapp.net");
		expect(result?.senderType).toBe("pn");
		expect(result?.companionLidJid).toBe("123456789012345@lid");
		expect(result?.fromMe).toBe(false);
		expect(result?.content.type).toBe("text");
		expect(result?.content.text).toBe("Hello Iny");
		expect(result?.timestamp).toBe(1727223000000);
	});

	it("returns null companionLidJid if remoteJidAlt is not a LID", () => {
		const raw: WAMessage = {
			key: {
				id: "msg-alt-not-lid",
				remoteJid: "919876543210@s.whatsapp.net",
				remoteJidAlt: "919876543211@s.whatsapp.net",
				fromMe: false,
			},
			message: { conversation: "Hello" },
		};
		const result = normalizer.normalize(raw);
		expect(result?.companionLidJid).toBeNull();
	});

	it("normalizes direct LID message and marks senderType as lid", () => {
		const raw: WAMessage = {
			key: {
				id: "msg-lid-1",
				remoteJid: "123456789012345@lid",
				fromMe: false,
			},
			message: { extendedTextMessage: { text: "Hello from LID" } },
			messageTimestamp: 1727223000,
		};
		const result = normalizer.normalize(raw);
		expect(result).not.toBeNull();
		expect(result?.chatType).toBe("direct");
		expect(result?.senderType).toBe("lid");
		expect(result?.senderJid).toBe("123456789012345@lid");
		expect(result?.companionLidJid).toBeNull();
		expect(result?.content.type).toBe("text");
		expect(result?.content.text).toBe("Hello from LID");
	});

	it("normalizes direct message when remoteJid is LID and remoteJidAlt is PN", () => {
		const raw: WAMessage = {
			key: {
				id: "msg-lid-pn-alt",
				remoteJid: "123456789012345:1@lid",
				remoteJidAlt: "919876543210@s.whatsapp.net",
				fromMe: false,
			},
			message: { conversation: "Hello from LID with PN alt" },
			messageTimestamp: 1727223000,
		};
		const result = normalizer.normalize(raw);
		expect(result).not.toBeNull();
		expect(result?.chatJid).toBe("123456789012345:1@lid");
		expect(result?.senderJid).toBe("919876543210@s.whatsapp.net");
		expect(result?.senderType).toBe("pn");
		expect(result?.companionLidJid).toBe("123456789012345@lid");
	});

	it("falls back to current time in milliseconds when timestamp is missing or invalid", () => {
		const before = Date.now();
		const raw: WAMessage = {
			key: {
				id: "msg-no-ts",
				remoteJid: "919876543210@s.whatsapp.net",
				fromMe: false,
			},
			message: { conversation: "No timestamp" },
		};
		const result = normalizer.normalize(raw);
		const after = Date.now();
		expect(result?.timestamp).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
		expect(result?.timestamp).toBeLessThanOrEqual(Math.floor(after / 1000) * 1000 + 1000);
	});

	it("normalizes group image announcement with lazy media closure", async () => {
		const raw: WAMessage = {
			key: {
				id: "msg-img-1",
				remoteJid: "120363045678901234@g.us",
				participant: "919876543210:2@s.whatsapp.net",
				fromMe: false,
			},
			message: {
				imageMessage: {
					mimetype: "image/jpeg",
					caption: "Dinner Menu for today",
				},
			},
			messageTimestamp: 1727223000,
		};
		const fakeMediaDownloader = vi.fn().mockResolvedValue(Buffer.from("image-bytes"));
		const extractor = new WhatsAppMessageContentExtractor(mockLogger, fakeMediaDownloader);
		const customNormalizer = new WhatsAppMessageNormalizer(mockLogger, extractor);
		const result = customNormalizer.normalize(raw);
		expect(result?.chatType).toBe("group");
		expect(result?.chatJid).toBe("120363045678901234@g.us");
		expect(result?.senderJid).toBe("919876543210@s.whatsapp.net");
		expect(result?.companionLidJid).toBeNull();
		expect(result?.content.type).toBe("image");
		expect(result?.content.text).toBe("Dinner Menu for today");

		const buffer = await result?.downloadMedia();
		expect(fakeMediaDownloader).toHaveBeenCalledWith(raw, "buffer", {});
		expect(buffer?.toString()).toBe("image-bytes");
	});

	it("normalizes document message with caption", async () => {
		const raw: WAMessage = {
			key: {
				id: "msg-doc-1",
				remoteJid: "120363045678901234@g.us",
				participant: "919876543210@s.whatsapp.net",
				fromMe: false,
			},
			message: {
				documentMessage: {
					mimetype: "application/pdf",
					fileName: "menu.pdf",
					caption: "Weekly Menu",
				},
			},
			messageTimestamp: 1727223000,
		};
		const fakeMediaDownloader = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
		const extractor = new WhatsAppMessageContentExtractor(mockLogger, fakeMediaDownloader);
		const customNormalizer = new WhatsAppMessageNormalizer(mockLogger, extractor);
		const result = customNormalizer.normalize(raw);
		expect(result?.content.type).toBe("document");
		expect(result?.content.text).toBe("Weekly Menu");
		expect(result?.content.mimeType).toBe("application/pdf");

		const buffer = await result?.downloadMedia();
		expect(buffer).toEqual(Buffer.from([1, 2, 3]));
	});

	it("lazy media closure returns null gracefully if downloader throws", async () => {
		const raw: WAMessage = {
			key: {
				id: "msg-fail",
				remoteJid: "120363045678901234@g.us",
				participant: "919876543210@s.whatsapp.net",
				fromMe: false,
			},
			message: { imageMessage: { mimetype: "image/jpeg" } },
		};
		const failingDownloader = vi.fn().mockRejectedValue(new Error("Socket disconnected"));
		const extractor = new WhatsAppMessageContentExtractor(mockLogger, failingDownloader);
		const customNormalizer = new WhatsAppMessageNormalizer(mockLogger, extractor);
		const result = customNormalizer.normalize(raw);
		const buffer = await result?.downloadMedia();
		expect(buffer).toBeNull();
		expect(mockLogger.warn).toHaveBeenCalledWith(
			"Failed to download media for message",
			expect.any(Error),
			expect.any(Object),
		);
	});

	it("lazy media closure returns null without calling downloader for text messages", async () => {
		const raw: WAMessage = {
			key: {
				id: "msg-text-1",
				remoteJid: "919876543210@s.whatsapp.net",
				fromMe: false,
			},
			message: { conversation: "Plain text" },
		};
		const fakeMediaDownloader = vi.fn();
		const extractor = new WhatsAppMessageContentExtractor(mockLogger, fakeMediaDownloader);
		const customNormalizer = new WhatsAppMessageNormalizer(mockLogger, extractor);
		const result = customNormalizer.normalize(raw);
		const buffer = await result?.downloadMedia();
		expect(buffer).toBeNull();
		expect(fakeMediaDownloader).not.toHaveBeenCalled();
	});

	it("normalizes broadcast channel message", () => {
		const raw: WAMessage = {
			key: {
				id: "msg-bcast-1",
				remoteJid: "1234567890@broadcast",
				fromMe: false,
			},
			message: { conversation: "Broadcast announcement" },
		};
		const result = normalizer.normalize(raw);
		expect(result?.chatType).toBe("broadcast");
		expect(result?.chatJid).toBe("1234567890@broadcast");
	});

	it("marks fromMe true for bot-originated messages", () => {
		const raw: WAMessage = {
			key: {
				id: "msg-me-1",
				remoteJid: "919876543210@s.whatsapp.net",
				fromMe: true,
			},
			message: { conversation: "Bot response" },
		};
		const result = normalizer.normalize(raw);
		expect(result?.fromMe).toBe(true);
	});

	it("marks unsupported message types when content cannot be mapped", () => {
		const raw: WAMessage = {
			key: {
				id: "msg-unknown-1",
				remoteJid: "919876543210@s.whatsapp.net",
				fromMe: false,
			},
			message: { audioMessage: { mimetype: "audio/ogg" } },
		};
		const result = normalizer.normalize(raw);
		expect(result?.content.type).toBe("unsupported");
		expect(result?.content.text).toBeNull();
		expect(result?.content.mimeType).toBeNull();
	});

	it("satisfies WhatsAppMessageHandler contract interface", async () => {
		const handler: WhatsAppMessageHandler = {
			name: "test-handler",
			acceptedUpsertTypes: ["notify", "append"],
			matches: (msg: NormalizedWhatsAppMessage) => msg.chatType === "direct",
			handle: async (_msg: NormalizedWhatsAppMessage) => {},
		};
		expect(handler.name).toBe("test-handler");
		expect(handler.acceptedUpsertTypes).toEqual(["notify", "append"]);
	});
});
