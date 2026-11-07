import { describe, it, expect, vi } from "vitest";
import {
	StageIncomingFoodAnnouncement,
	type StageFoodAnnouncementCommand,
} from "../../../src/core/use-cases/StageIncomingFoodAnnouncement";
import type { FoodIngestionRepositoryPort } from "../../../src/core/ports/FoodIngestionRepositoryPort";
import type { LoggerPort } from "../../../src/core/ports/LoggerPort";

const source: StageFoodAnnouncementCommand = {
	messageId: "msg-123",
	groupJid: "food@g.us",
	senderAddress: "919876543210@s.whatsapp.net",
	senderAddressType: "pn",
	deliveryMode: "notify",
	originalCreatedAt: null,
	capturedAt: new Date("2026-11-01T00:00:00Z"),
	messageType: "text",
	textBody: "Today lunch changed to hall B",
	mediaMimeType: null,
	mediaBytes: null,
};
function setup() {
	const captured: StageFoodAnnouncementCommand[] = [];
	const logger: LoggerPort = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis(),
	};
	const repository: FoodIngestionRepositoryPort = {
		initialize: vi.fn(),
		claimNext: vi.fn(),
		accept: vi.fn(),
		reject: vi.fn(),
		fail: vi.fn(),
		capture: async (command) => {
			captured.push(command);
			return "ineligible";
		},
	};
	return {
		captured,
		repository,
		logger,
		useCase: new StageIncomingFoodAnnouncement(repository, logger),
	};
}
describe("StageIncomingFoodAnnouncement atomic capture", () => {
	it("passes the untouched pure source to the atomic persistence boundary once", async () => {
		const c = setup();
		await c.useCase.execute(source);
		expect(c.captured).toEqual([source]);
		expect(c.captured[0]).toBe(source);
	});
	it.each(["messageId", "groupJid", "senderAddress"] as const)(
		"rejects missing %s without persisting",
		async (field) => {
			const c = setup();
			for (const value of ["", "  "]) {
				await expect(c.useCase.execute({ ...source, [field]: value })).rejects.toThrow(
					`${field} is required`,
				);
			}
			expect(c.captured).toEqual([]);
		},
	);
	it.each([null, "", "  "])("rejects text without actual text content: %s", async (textBody) => {
		const c = setup();
		await expect(c.useCase.execute({ ...source, textBody })).rejects.toThrow("content");
		expect(c.captured).toEqual([]);
	});
	it.each([null, new Uint8Array()])(
		"rejects empty media even with a caption",
		async (mediaBytes) => {
			const c = setup();
			await expect(
				c.useCase.execute({ ...source, messageType: "image", mediaBytes }),
			).rejects.toThrow("content");
			expect(c.captured).toEqual([]);
		},
	);
	it("allows media-only Uint8Array input without depending on Buffer", async () => {
		const c = setup();
		const media = {
			...source,
			messageType: "image" as const,
			textBody: null,
			mediaBytes: new Uint8Array([1]),
		};
		await c.useCase.execute(media);
		expect(c.captured).toEqual([media]);
	});
	it("does not report success after capture failure and allows transport retry", async () => {
		const c = setup();
		const error = new Error("database unavailable");
		c.repository.capture = async () => {
			throw error;
		};
		await expect(c.useCase.execute(source)).rejects.toBe(error);
		expect(c.logger.info).not.toHaveBeenCalled();
		expect(c.logger.error).toHaveBeenCalledWith("Food announcement capture failed", error, {
			messageId: "msg-123",
			phase: "capture",
		});
		c.repository.capture = async (command) => {
			c.captured.push(command);
			return "admitted";
		};
		await c.useCase.execute(source);
		expect(c.captured).toEqual([source]);
	});
});
