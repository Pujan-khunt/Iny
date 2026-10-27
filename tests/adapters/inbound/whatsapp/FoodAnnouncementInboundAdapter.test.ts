import { describe, it, expect, vi } from "vitest";
import { FoodAnnouncementInboundAdapter } from "../../../../src/adapters/inbound/whatsapp/FoodAnnouncementInboundAdapter";
import { NormalizedWhatsAppMessage } from "../../../../src/adapters/inbound/whatsapp/router/NormalizedWhatsAppMessage";

describe("FoodAnnouncementInboundAdapter", () => {
	const targetGroupJid = "120363045678901234@g.us";

	const createMockUseCase = () => ({
		execute: vi.fn().mockResolvedValue(undefined),
	});

	const createMockLogger = () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis(),
	});

	it("has name food-announcement and accepts notify and append upserts", () => {
		const adapter = new FoodAnnouncementInboundAdapter({
			targetGroupJid,
			useCase: createMockUseCase() as any,
			logger: createMockLogger() as any,
		});

		expect(adapter.name).toBe("food-announcement");
		expect(adapter.acceptedUpsertTypes).toEqual(["notify", "append"]);
	});

	describe("matches", () => {
		it("matches target group document message", () => {
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid,
				useCase: createMockUseCase() as any,
				logger: createMockLogger() as any,
			});

			const msg: NormalizedWhatsAppMessage = {
				messageId: "food-doc-1",
				chatJid: targetGroupJid,
				chatType: "group",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				content: {
					type: "document",
					text: "menu.pdf",
					mimeType: "application/pdf",
				},
				downloadMedia: vi.fn(),
			};

			expect(adapter.matches(msg)).toBe(true);
		});

		it("matches target group image message", () => {
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid,
				useCase: createMockUseCase() as any,
				logger: createMockLogger() as any,
			});

			const msg: NormalizedWhatsAppMessage = {
				messageId: "food-img-1",
				chatJid: targetGroupJid,
				chatType: "group",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				content: { type: "image", text: "menu.jpg", mimeType: "image/jpeg" },
				downloadMedia: vi.fn(),
			};

			expect(adapter.matches(msg)).toBe(true);
		});

		it("matches target group text message", () => {
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid,
				useCase: createMockUseCase() as any,
				logger: createMockLogger() as any,
			});

			const msg: NormalizedWhatsAppMessage = {
				messageId: "food-txt-1",
				chatJid: targetGroupJid,
				chatType: "group",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				content: { type: "text", text: "Dinner is delayed", mimeType: null },
				downloadMedia: vi.fn(),
			};

			expect(adapter.matches(msg)).toBe(true);
		});

		it("rejects text messages with empty or whitespace-only content", () => {
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid,
				useCase: createMockUseCase() as any,
				logger: createMockLogger() as any,
			});

			const emptyMsg: NormalizedWhatsAppMessage = {
				messageId: "food-empty-1",
				chatJid: targetGroupJid,
				chatType: "group",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				content: { type: "text", text: "", mimeType: null },
				downloadMedia: vi.fn(),
			};

			const whitespaceMsg: NormalizedWhatsAppMessage = {
				...emptyMsg,
				messageId: "food-ws-1",
				content: { type: "text", text: "   \n\t  ", mimeType: null },
			};

			expect(adapter.matches(emptyMsg)).toBe(false);
			expect(adapter.matches(whitespaceMsg)).toBe(false);
		});

		it("rejects message authored by connected bot (fromMe=true)", () => {
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid,
				useCase: createMockUseCase() as any,
				logger: createMockLogger() as any,
			});

			const msg: NormalizedWhatsAppMessage = {
				messageId: "food-from-me",
				chatJid: targetGroupJid,
				chatType: "group",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: true,
				timestamp: Date.now(),
				content: { type: "text", text: "Bot message", mimeType: null },
				downloadMedia: vi.fn(),
			};

			expect(adapter.matches(msg)).toBe(false);
		});

		it("rejects direct messages and messages from other groups", () => {
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid,
				useCase: createMockUseCase() as any,
				logger: createMockLogger() as any,
			});

			const directMsg: NormalizedWhatsAppMessage = {
				messageId: "dm-1",
				chatJid: "919876543210@s.whatsapp.net",
				chatType: "direct",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				content: { type: "text", text: "Direct message", mimeType: null },
				downloadMedia: vi.fn(),
			};

			const otherGroupMsg: NormalizedWhatsAppMessage = {
				messageId: "other-grp-1",
				chatJid: "120999999999999999@g.us",
				chatType: "group",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				content: { type: "text", text: "Other group message", mimeType: null },
				downloadMedia: vi.fn(),
			};

			expect(adapter.matches(directMsg)).toBe(false);
			expect(adapter.matches(otherGroupMsg)).toBe(false);
		});

		it("rejects unsupported message type", () => {
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid,
				useCase: createMockUseCase() as any,
				logger: createMockLogger() as any,
			});

			const unsupportedMsg: NormalizedWhatsAppMessage = {
				messageId: "food-unsupported-1",
				chatJid: targetGroupJid,
				chatType: "group",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				content: { type: "unsupported", text: null, mimeType: null },
				downloadMedia: vi.fn(),
			};

			expect(adapter.matches(unsupportedMsg)).toBe(false);
		});
	});

	describe("handle", () => {
		it("downloads media and executes StageIncomingFoodAnnouncement for document messages", async () => {
			const mockUseCase = createMockUseCase();
			const mockLogger = createMockLogger();
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid,
				useCase: mockUseCase as any,
				logger: mockLogger as any,
			});

			const fakeBuffer = Buffer.from("pdf-bytes");
			const downloadMedia = vi.fn().mockResolvedValue(fakeBuffer);
			const msg: NormalizedWhatsAppMessage = {
				messageId: "food-doc-1",
				chatJid: targetGroupJid,
				chatType: "group",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				content: {
					type: "document",
					text: "menu.pdf",
					mimeType: "application/pdf",
				},
				downloadMedia,
			};

			await adapter.handle(msg);

			expect(downloadMedia).toHaveBeenCalledTimes(1);
			expect(mockLogger.debug).toHaveBeenCalledWith(
				"Downloaded media attachment for food announcement",
				{
					messageId: "food-doc-1",
					mediaMimeType: "application/pdf",
					bufferSize: fakeBuffer.length,
				},
			);
			expect(mockUseCase.execute).toHaveBeenCalledWith({
				id: "food-doc-1",
				senderAddress: "919876543210@s.whatsapp.net",
				senderAddressType: "pn",
				messageType: "document",
				textBody: "menu.pdf",
				mediaMimeType: "application/pdf",
				mediaBuffer: fakeBuffer,
				receivedAt: new Date(msg.timestamp),
			});
		});

		it("downloads media and executes StageIncomingFoodAnnouncement for image messages", async () => {
			const mockUseCase = createMockUseCase();
			const mockLogger = createMockLogger();
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid,
				useCase: mockUseCase as any,
				logger: mockLogger as any,
			});

			const fakeBuffer = Buffer.from("image-bytes");
			const downloadMedia = vi.fn().mockResolvedValue(fakeBuffer);
			const msg: NormalizedWhatsAppMessage = {
				messageId: "food-img-1",
				chatJid: targetGroupJid,
				chatType: "group",
				senderJid: "123456789012345@lid",
				senderType: "lid",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				content: { type: "image", text: "Menu photo", mimeType: "image/jpeg" },
				downloadMedia,
			};

			await adapter.handle(msg);

			expect(downloadMedia).toHaveBeenCalledTimes(1);
			expect(mockLogger.debug).toHaveBeenCalledWith(
				"Downloaded media attachment for food announcement",
				{
					messageId: "food-img-1",
					mediaMimeType: "image/jpeg",
					bufferSize: fakeBuffer.length,
				},
			);
			expect(mockUseCase.execute).toHaveBeenCalledWith({
				id: "food-img-1",
				senderAddress: "123456789012345@lid",
				senderAddressType: "lid",
				messageType: "image",
				textBody: "Menu photo",
				mediaMimeType: "image/jpeg",
				mediaBuffer: fakeBuffer,
				receivedAt: new Date(msg.timestamp),
			});
		});

		it("passes mediaBuffer as null for text messages", async () => {
			const mockUseCase = createMockUseCase();
			const mockLogger = createMockLogger();
			const adapter = new FoodAnnouncementInboundAdapter({
				targetGroupJid,
				useCase: mockUseCase as any,
				logger: mockLogger as any,
			});

			const downloadMedia = vi.fn().mockResolvedValue(null);
			const msg: NormalizedWhatsAppMessage = {
				messageId: "food-text-1",
				chatJid: targetGroupJid,
				chatType: "group",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				content: { type: "text", text: "Lunch is ready", mimeType: null },
				downloadMedia,
			};

			await adapter.handle(msg);

			expect(downloadMedia).toHaveBeenCalled();
			expect(mockUseCase.execute).toHaveBeenCalledWith({
				id: "food-text-1",
				senderAddress: "919876543210@s.whatsapp.net",
				senderAddressType: "pn",
				messageType: "text",
				textBody: "Lunch is ready",
				mediaMimeType: null,
				mediaBuffer: null,
				receivedAt: new Date(msg.timestamp),
			});
		});
	});
});
