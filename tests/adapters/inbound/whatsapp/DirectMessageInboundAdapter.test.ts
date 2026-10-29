import { describe, it, expect, vi } from "vitest";
import { DirectMessageInboundAdapter } from "../../../../src/adapters/inbound/whatsapp/DirectMessageInboundAdapter";
import { NormalizedWhatsAppMessage } from "../../../../src/adapters/inbound/whatsapp/router/NormalizedWhatsAppMessage";

describe("DirectMessageInboundAdapter", () => {
	const createMockUseCase = () => ({
		execute: vi.fn().mockResolvedValue(undefined),
	});

	const createMockAccessControl = () => ({
		authenticate: vi.fn().mockResolvedValue({
			phoneNumber: "+919876543210",
			pnJid: "919876543210@s.whatsapp.net",
			lidJid: null,
			name: "Test User",
			role: "user",
			status: "active",
			createdAt: new Date(),
			updatedAt: new Date(),
		}),
		getUser: vi.fn(),
	});

	const createMockLogger = () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis(),
	});

	it("has name direct-message and accepts notify upserts", () => {
		const adapter = new DirectMessageInboundAdapter(
			createMockUseCase() as any,
			createMockAccessControl() as any,
			createMockLogger() as any,
		);

		expect(adapter.name).toBe("direct-message");
		expect(adapter.acceptedUpsertTypes).toEqual(["notify"]);
	});

	describe("matches", () => {
		it("matches direct text messages from other users", () => {
			const adapter = new DirectMessageInboundAdapter(
				createMockUseCase() as any,
				createMockAccessControl() as any,
				createMockLogger() as any,
			);

			const msg: NormalizedWhatsAppMessage = {
				messageId: "dm-1",
				chatJid: "919876543210@s.whatsapp.net",
				chatType: "direct",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				content: { type: "text", text: "What is for lunch?", mimeType: null },
				downloadMedia: vi.fn(),
			};

			expect(adapter.matches(msg)).toBe(true);
		});

		it("rejects messages authored by connected bot (fromMe=true)", () => {
			const adapter = new DirectMessageInboundAdapter(
				createMockUseCase() as any,
				createMockAccessControl() as any,
				createMockLogger() as any,
			);

			const msg: NormalizedWhatsAppMessage = {
				messageId: "dm-from-me",
				chatJid: "919876543210@s.whatsapp.net",
				chatType: "direct",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: true,
				timestamp: Date.now(),
				content: { type: "text", text: "Hello", mimeType: null },
				downloadMedia: vi.fn(),
			};

			expect(adapter.matches(msg)).toBe(false);
		});

		it("rejects group and broadcast chat messages", () => {
			const adapter = new DirectMessageInboundAdapter(
				createMockUseCase() as any,
				createMockAccessControl() as any,
				createMockLogger() as any,
			);

			const groupMsg: NormalizedWhatsAppMessage = {
				messageId: "grp-1",
				chatJid: "120363045678901234@g.us",
				chatType: "group",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				content: { type: "text", text: "Group text", mimeType: null },
				downloadMedia: vi.fn(),
			};

			expect(adapter.matches(groupMsg)).toBe(false);
		});

		it("rejects non-text direct messages", () => {
			const adapter = new DirectMessageInboundAdapter(
				createMockUseCase() as any,
				createMockAccessControl() as any,
				createMockLogger() as any,
			);

			const imageMsg: NormalizedWhatsAppMessage = {
				messageId: "img-1",
				chatJid: "919876543210@s.whatsapp.net",
				chatType: "direct",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				content: { type: "image", text: "Photo", mimeType: "image/jpeg" },
				downloadMedia: vi.fn(),
			};

			expect(adapter.matches(imageMsg)).toBe(false);
		});

		it("rejects whitespace-only direct messages", () => {
			const adapter = new DirectMessageInboundAdapter(
				createMockUseCase() as any,
				createMockAccessControl() as any,
				createMockLogger() as any,
			);

			const whitespaceMsg: NormalizedWhatsAppMessage = {
				messageId: "dm-spaces",
				chatJid: "919876543210@s.whatsapp.net",
				chatType: "direct",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				content: { type: "text", text: "   \t\n  ", mimeType: null },
				downloadMedia: vi.fn(),
			};

			expect(adapter.matches(whitespaceMsg)).toBe(false);
		});

		it("rejects empty direct messages", () => {
			const adapter = new DirectMessageInboundAdapter(
				createMockUseCase() as any,
				createMockAccessControl() as any,
				createMockLogger() as any,
			);

			const emptyMsg: NormalizedWhatsAppMessage = {
				messageId: "dm-empty",
				chatJid: "919876543210@s.whatsapp.net",
				chatType: "direct",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				content: { type: "text", text: "", mimeType: null },
				downloadMedia: vi.fn(),
			};

			expect(adapter.matches(emptyMsg)).toBe(false);
		});
	});

	describe("handle", () => {
		it("authenticates sender and executes HandleIncomingUserMessage", async () => {
			const mockUseCase = createMockUseCase();
			const mockAccessControl = createMockAccessControl();
			const mockLogger = createMockLogger();
			const adapter = new DirectMessageInboundAdapter(
				mockUseCase as any,
				mockAccessControl as any,
				mockLogger as any,
			);

			const now = Date.now();
			const msg: NormalizedWhatsAppMessage = {
				messageId: "dm-valid-1",
				chatJid: "919876543210@s.whatsapp.net",
				chatType: "direct",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: "123456789012345@lid",
				fromMe: false,
				timestamp: now,
				content: { type: "text", text: "What is for lunch?", mimeType: null },
				downloadMedia: vi.fn(),
			};

			await adapter.handle(msg);

			expect(mockAccessControl.authenticate).toHaveBeenCalledWith(
				"919876543210@s.whatsapp.net",
				"123456789012345@lid",
			);
			expect(mockUseCase.execute).toHaveBeenCalledWith(
				expect.objectContaining({
					id: "dm-valid-1",
					userId: "919876543210@s.whatsapp.net",
					role: "user",
					content: "What is for lunch?",
					timestamp: new Date(now),
				}),
			);
		});

		it("logs debug and returns early when user is unauthorized or inactive", async () => {
			const mockUseCase = createMockUseCase();
			const mockAccessControl = createMockAccessControl();
			mockAccessControl.authenticate.mockResolvedValue(null);
			const mockLogger = createMockLogger();
			const adapter = new DirectMessageInboundAdapter(
				mockUseCase as any,
				mockAccessControl as any,
				mockLogger as any,
			);

			const msg: NormalizedWhatsAppMessage = {
				messageId: "dm-unauth-1",
				chatJid: "919999999999@s.whatsapp.net",
				chatType: "direct",
				senderJid: "919999999999@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				content: { type: "text", text: "Unauthorized message", mimeType: null },
				downloadMedia: vi.fn(),
			};

			await adapter.handle(msg);

			expect(mockAccessControl.authenticate).toHaveBeenCalledWith(
				"919999999999@s.whatsapp.net",
				null,
			);
			expect(mockUseCase.execute).not.toHaveBeenCalled();
			expect(mockLogger.debug).toHaveBeenCalledWith(
				"Ignored message from unauthorized or inactive sender",
				expect.objectContaining({
					senderJid: "919999999999@s.whatsapp.net",
					companionLidJid: null,
				}),
			);
		});

		it("handles message with null text by defaulting content to empty string", async () => {
			const mockUseCase = createMockUseCase();
			const mockAccessControl = createMockAccessControl();
			const mockLogger = createMockLogger();
			const adapter = new DirectMessageInboundAdapter(
				mockUseCase as any,
				mockAccessControl as any,
				mockLogger as any,
			);

			const msg: NormalizedWhatsAppMessage = {
				messageId: "dm-empty-1",
				chatJid: "919876543210@s.whatsapp.net",
				chatType: "direct",
				senderJid: "919876543210@s.whatsapp.net",
				senderType: "pn",
				companionLidJid: null,
				fromMe: false,
				timestamp: Date.now(),
				content: { type: "text", text: null, mimeType: null },
				downloadMedia: vi.fn(),
			};

			await adapter.handle(msg);

			expect(mockUseCase.execute).toHaveBeenCalledWith(
				expect.objectContaining({
					id: "dm-empty-1",
					content: "",
				}),
			);
		});
	});
});
