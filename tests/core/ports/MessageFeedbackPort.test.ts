import { describe, it, expect, vi } from "vitest";
import { MessageFeedbackPort } from "../../../src/core/ports/MessageFeedbackPort";

describe("MessageFeedbackPort contract", () => {
	it("should allow conforming implementations to satisfy the interface", async () => {
		const mockFeedback: MessageFeedbackPort = {
			sendReadReceipt: vi.fn().mockResolvedValue(undefined),
			sendTypingIndicator: vi.fn().mockResolvedValue(undefined),
			sendReaction: vi.fn().mockResolvedValue(undefined),
		};

		await mockFeedback.sendReadReceipt("user-1", "msg-1");
		await mockFeedback.sendTypingIndicator("user-1", "composing");
		await mockFeedback.sendReaction("user-1", "msg-1", "👀");

		expect(mockFeedback.sendReadReceipt).toHaveBeenCalledWith("user-1", "msg-1");
		expect(mockFeedback.sendTypingIndicator).toHaveBeenCalledWith("user-1", "composing");
		expect(mockFeedback.sendReaction).toHaveBeenCalledWith("user-1", "msg-1", "👀");
	});
});
