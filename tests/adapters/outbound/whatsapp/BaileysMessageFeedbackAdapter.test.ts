import { describe, it, expect, vi, beforeEach } from "vitest";
import { BaileysMessageFeedbackAdapter } from "../../../../src/adapters/outbound/whatsapp/BaileysMessageFeedbackAdapter";
import { BaileysConnectionManager } from "../../../../src/adapters/outbound/whatsapp/BaileysConnectionManager";
import { LoggerPort } from "../../../../src/core/ports/LoggerPort";

describe("BaileysMessageFeedbackAdapter", () => {
	let mockLogger: LoggerPort;
	let mockSocket: {
		readMessages: ReturnType<typeof vi.fn>;
		sendPresenceUpdate: ReturnType<typeof vi.fn>;
		sendMessage: ReturnType<typeof vi.fn>;
	};
	let mockConnManager: BaileysConnectionManager;

	beforeEach(() => {
		mockLogger = {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			fatal: vi.fn(),
			child: vi.fn().mockReturnThis(),
		};
		mockSocket = {
			readMessages: vi.fn().mockResolvedValue(undefined),
			sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
			sendMessage: vi.fn().mockResolvedValue({}),
		};
		mockConnManager = {
			getSocket: vi.fn().mockReturnValue(mockSocket),
		} as unknown as BaileysConnectionManager;
	});

	describe("sendReadReceipt", () => {
		it("should transmit read receipt key to socket", async () => {
			const adapter = new BaileysMessageFeedbackAdapter(mockConnManager, mockLogger);

			await adapter.sendReadReceipt("user1@s.whatsapp.net", "msg-123");

			expect(mockSocket.readMessages).toHaveBeenCalledWith([
				{ remoteJid: "user1@s.whatsapp.net", id: "msg-123" },
			]);
		});

		it("should throw error if socket is not connected", async () => {
			vi.mocked(mockConnManager.getSocket).mockReturnValue(null);
			const adapter = new BaileysMessageFeedbackAdapter(mockConnManager, mockLogger);

			await expect(adapter.sendReadReceipt("user1@s.whatsapp.net", "msg-123")).rejects.toThrow(
				"WhatsApp socket is not connected",
			);
			expect(mockSocket.readMessages).not.toHaveBeenCalled();
		});

		it("should log error and rethrow when readMessages fails", async () => {
			const error = new Error("Transport socket failed");
			mockSocket.readMessages.mockRejectedValue(error);
			const adapter = new BaileysMessageFeedbackAdapter(mockConnManager, mockLogger);

			await expect(adapter.sendReadReceipt("user1@s.whatsapp.net", "msg-123")).rejects.toThrow(
				"Transport socket failed",
			);
			expect(mockLogger.error).toHaveBeenCalledWith("Failed to send WhatsApp read receipt", error, {
				recipientPnJid: "user1@s.whatsapp.net",
				messageId: "msg-123",
			});
		});
	});

	describe("sendTypingIndicator", () => {
		it("should transmit composing presence update to socket", async () => {
			const adapter = new BaileysMessageFeedbackAdapter(mockConnManager, mockLogger);

			await adapter.sendTypingIndicator("user1@s.whatsapp.net", "composing");

			expect(mockSocket.sendPresenceUpdate).toHaveBeenCalledWith(
				"composing",
				"user1@s.whatsapp.net",
			);
		});

		it("should transmit paused presence update to socket", async () => {
			const adapter = new BaileysMessageFeedbackAdapter(mockConnManager, mockLogger);

			await adapter.sendTypingIndicator("user1@s.whatsapp.net", "paused");

			expect(mockSocket.sendPresenceUpdate).toHaveBeenCalledWith("paused", "user1@s.whatsapp.net");
		});

		it("should throw error if socket is not connected", async () => {
			vi.mocked(mockConnManager.getSocket).mockReturnValue(null);
			const adapter = new BaileysMessageFeedbackAdapter(mockConnManager, mockLogger);

			await expect(
				adapter.sendTypingIndicator("user1@s.whatsapp.net", "composing"),
			).rejects.toThrow("WhatsApp socket is not connected");
		});

		it("should log error and rethrow when sendPresenceUpdate fails", async () => {
			const error = new Error("Presence transport failed");
			mockSocket.sendPresenceUpdate.mockRejectedValue(error);
			const adapter = new BaileysMessageFeedbackAdapter(mockConnManager, mockLogger);

			await expect(
				adapter.sendTypingIndicator("user1@s.whatsapp.net", "composing"),
			).rejects.toThrow("Presence transport failed");
			expect(mockLogger.error).toHaveBeenCalledWith(
				"Failed to send WhatsApp presence update",
				error,
				{
					recipientPnJid: "user1@s.whatsapp.net",
					presence: "composing",
				},
			);
		});
	});

	describe("sendReaction", () => {
		it("should transmit reaction payload to socket", async () => {
			const adapter = new BaileysMessageFeedbackAdapter(mockConnManager, mockLogger);

			await adapter.sendReaction("user1@s.whatsapp.net", "msg-123", "👀");

			expect(mockSocket.sendMessage).toHaveBeenCalledWith("user1@s.whatsapp.net", {
				react: {
					text: "👀",
					key: { remoteJid: "user1@s.whatsapp.net", id: "msg-123" },
				},
			});
		});

		it("should transmit empty reaction to remove emoji from message", async () => {
			const adapter = new BaileysMessageFeedbackAdapter(mockConnManager, mockLogger);

			await adapter.sendReaction("user1@s.whatsapp.net", "msg-123", "");

			expect(mockSocket.sendMessage).toHaveBeenCalledWith("user1@s.whatsapp.net", {
				react: {
					text: "",
					key: { remoteJid: "user1@s.whatsapp.net", id: "msg-123" },
				},
			});
		});

		it("should throw error if socket is not connected", async () => {
			vi.mocked(mockConnManager.getSocket).mockReturnValue(null);
			const adapter = new BaileysMessageFeedbackAdapter(mockConnManager, mockLogger);

			await expect(adapter.sendReaction("user1@s.whatsapp.net", "msg-123", "👀")).rejects.toThrow(
				"WhatsApp socket is not connected",
			);
		});

		it("should log error and rethrow when sendMessage fails", async () => {
			const error = new Error("Reaction transport failed");
			mockSocket.sendMessage.mockRejectedValue(error);
			const adapter = new BaileysMessageFeedbackAdapter(mockConnManager, mockLogger);

			await expect(adapter.sendReaction("user1@s.whatsapp.net", "msg-123", "👀")).rejects.toThrow(
				"Reaction transport failed",
			);
			expect(mockLogger.error).toHaveBeenCalledWith("Failed to send WhatsApp reaction", error, {
				recipientPnJid: "user1@s.whatsapp.net",
				messageId: "msg-123",
				reaction: "👀",
			});
		});
	});
});
