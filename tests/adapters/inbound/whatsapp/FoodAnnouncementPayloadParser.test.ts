import { describe, it, expect, vi } from "vitest";
import { FoodAnnouncementPayloadParser } from "../../../../src/adapters/inbound/whatsapp/FoodAnnouncementPayloadParser";
import { WAMessage } from "@whiskeysockets/baileys";
import { LoggerPort } from "../../../../src/core/ports/LoggerPort";

describe("FoodAnnouncementPayloadParser", () => {
	const TARGET_GROUP_JID = "120363045678901234@g.us";

	const mockLogger: LoggerPort = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis(),
	};

	it("returns null when msg or key is missing", () => {
		const parser = new FoodAnnouncementPayloadParser(mockLogger);
		expect(parser.parse(null as unknown as WAMessage, TARGET_GROUP_JID)).toBeNull();
		expect(parser.parse({} as unknown as WAMessage, TARGET_GROUP_JID)).toBeNull();
	});

	it("returns null when remoteJid does not match target group", () => {
		const parser = new FoodAnnouncementPayloadParser(mockLogger);
		const msg: WAMessage = {
			key: {
				id: "msg-1",
				remoteJid: "other@g.us",
				fromMe: false,
				participant: "919876543210@s.whatsapp.net",
			},
			message: { conversation: "Hello" },
		};
		expect(parser.parse(msg, TARGET_GROUP_JID)).toBeNull();
	});

	it("returns null when fromMe is true or messageId is empty", () => {
		const parser = new FoodAnnouncementPayloadParser(mockLogger);
		const selfMsg: WAMessage = {
			key: {
				id: "msg-self",
				remoteJid: TARGET_GROUP_JID,
				fromMe: true,
				participant: "919876543210@s.whatsapp.net",
			},
			message: { conversation: "Self message" },
		};
		expect(parser.parse(selfMsg, TARGET_GROUP_JID)).toBeNull();

		const noIdMsg: WAMessage = {
			key: {
				id: "",
				remoteJid: TARGET_GROUP_JID,
				fromMe: false,
				participant: "919876543210@s.whatsapp.net",
			},
			message: { conversation: "No id" },
		};
		expect(parser.parse(noIdMsg, TARGET_GROUP_JID)).toBeNull();
	});

	it("returns null when participant is missing", () => {
		const parser = new FoodAnnouncementPayloadParser(mockLogger);
		const noPartMsg: WAMessage = {
			key: {
				id: "msg-no-part",
				remoteJid: TARGET_GROUP_JID,
				fromMe: false,
			},
			message: { conversation: "No participant" },
		};
		expect(parser.parse(noPartMsg, TARGET_GROUP_JID)).toBeNull();
	});

	it("returns null for unsupported message types", () => {
		const parser = new FoodAnnouncementPayloadParser();
		const audioMsg: WAMessage = {
			key: {
				id: "msg-audio",
				remoteJid: TARGET_GROUP_JID,
				fromMe: false,
				participant: "919876543210@s.whatsapp.net",
			},
			message: { audioMessage: { mimetype: "audio/ogg" } },
		};
		expect(parser.parse(audioMsg, TARGET_GROUP_JID)).toBeNull();
	});

	it("parses valid text message and normalizes PN sender", () => {
		const parser = new FoodAnnouncementPayloadParser();
		const textMsg: WAMessage = {
			key: {
				id: "msg-txt",
				remoteJid: TARGET_GROUP_JID,
				fromMe: false,
				participant: "919876543210:2@s.whatsapp.net",
			},
			message: { conversation: "Dinner menu updated" },
		};
		const parsed = parser.parse(textMsg, TARGET_GROUP_JID);
		expect(parsed).toEqual({
			messageId: "msg-txt",
			senderAddress: "919876543210@s.whatsapp.net",
			senderAddressType: "pn",
			messageType: "text",
			mediaMimeType: null,
			textBody: "Dinner menu updated",
		});
	});

	it("parses valid document message with caption and normalizes LID sender", () => {
		const parser = new FoodAnnouncementPayloadParser();
		const docMsg: WAMessage = {
			key: {
				id: "msg-doc",
				remoteJid: TARGET_GROUP_JID,
				fromMe: false,
				participant: "123456789012345:1@lid",
			},
			message: {
				documentMessage: {
					mimetype: "application/pdf",
					caption: "Weekly Menu",
					fileName: "menu.pdf",
				},
			},
		};
		const parsed = parser.parse(docMsg, TARGET_GROUP_JID);
		expect(parsed).toEqual({
			messageId: "msg-doc",
			senderAddress: "123456789012345@lid",
			senderAddressType: "lid",
			messageType: "document",
			mediaMimeType: "application/pdf",
			textBody: "Weekly Menu",
		});
	});
});
