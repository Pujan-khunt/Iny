import { describe, it, expect, vi } from "vitest";
import {
	StageIncomingFoodAnnouncement,
	StageFoodAnnouncementCommand,
} from "../../../src/core/use-cases/StageIncomingFoodAnnouncement";
import { MessStagingRepositoryPort } from "../../../src/core/ports/MessStagingRepositoryPort";
import { LoggerPort } from "../../../src/core/ports/LoggerPort";

describe("StageIncomingFoodAnnouncement", () => {
	const createMockRepo = (): MessStagingRepositoryPort => ({
		stageMessage: vi.fn().mockResolvedValue("staged"),
		listStagedMessages: vi.fn(),
		getMessageById: vi.fn(),
		getMealsByDateAndSlot: vi.fn(),
		atomicCommit: vi.fn(),
		atomicCommitComposite: vi.fn(),
		markIgnored: vi.fn(),
		atomicUndo: vi.fn(),
		atomicReset: vi.fn(),
	});

	const createMockLogger = (): LoggerPort => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis(),
	});

	const validCommand: StageFoodAnnouncementCommand = {
		id: "msg-123",
		senderAddress: "919876543210@s.whatsapp.net",
		senderAddressType: "pn",
		messageType: "text",
		textBody: "Today lunch changed to hall B",
		mediaMimeType: null,
		mediaBuffer: null,
	};

	it("validates and stages pending food announcement record", async () => {
		const mockRepo = createMockRepo();
		const mockLogger = createMockLogger();
		const useCase = new StageIncomingFoodAnnouncement(mockRepo, mockLogger);

		await useCase.execute(validCommand);

		expect(mockRepo.stageMessage).toHaveBeenCalledWith({
			...validCommand,
			status: "pending",
		});
		expect(mockLogger.info).toHaveBeenCalledWith("Food announcement message staged successfully", {
			id: "msg-123",
		});
	});

	it("rejects command with missing or whitespace-only id", async () => {
		const mockRepo = createMockRepo();
		const mockLogger = createMockLogger();
		const useCase = new StageIncomingFoodAnnouncement(mockRepo, mockLogger);

		await expect(useCase.execute({ ...validCommand, id: "" })).rejects.toThrow(
			"Invalid announcement command: id is required",
		);
		await expect(useCase.execute({ ...validCommand, id: "   " })).rejects.toThrow(
			"Invalid announcement command: id is required",
		);
		expect(mockRepo.stageMessage).not.toHaveBeenCalled();
	});

	it("rejects command with missing or whitespace-only senderAddress", async () => {
		const mockRepo = createMockRepo();
		const mockLogger = createMockLogger();
		const useCase = new StageIncomingFoodAnnouncement(mockRepo, mockLogger);

		await expect(useCase.execute({ ...validCommand, senderAddress: "" })).rejects.toThrow(
			"Invalid announcement command: senderAddress is required",
		);
		await expect(useCase.execute({ ...validCommand, senderAddress: "   " })).rejects.toThrow(
			"Invalid announcement command: senderAddress is required",
		);
		expect(mockRepo.stageMessage).not.toHaveBeenCalled();
	});

	it("rejects command when both textBody and mediaBuffer are absent", async () => {
		const mockRepo = createMockRepo();
		const mockLogger = createMockLogger();
		const useCase = new StageIncomingFoodAnnouncement(mockRepo, mockLogger);

		await expect(
			useCase.execute({ ...validCommand, textBody: null, mediaBuffer: null }),
		).rejects.toThrow("Invalid announcement command: message must have text body or media content");
		await expect(
			useCase.execute({ ...validCommand, textBody: "   ", mediaBuffer: null }),
		).rejects.toThrow("Invalid announcement command: message must have text body or media content");
		expect(mockRepo.stageMessage).not.toHaveBeenCalled();
	});

	it("allows media-only message with null textBody", async () => {
		const mockRepo = createMockRepo();
		const mockLogger = createMockLogger();
		const useCase = new StageIncomingFoodAnnouncement(mockRepo, mockLogger);
		const mediaCommand: StageFoodAnnouncementCommand = {
			...validCommand,
			messageType: "image",
			textBody: null,
			mediaMimeType: "image/jpeg",
			mediaBuffer: Buffer.from("fake-image-bytes"),
		};

		await useCase.execute(mediaCommand);

		expect(mockRepo.stageMessage).toHaveBeenCalledWith({
			...mediaCommand,
			status: "pending",
		});
	});

	it("logs debug and ignores duplicate messages when repository returns already_staged", async () => {
		const mockRepo = createMockRepo();
		const mockLogger = createMockLogger();
		vi.mocked(mockRepo.stageMessage).mockResolvedValueOnce("already_staged");
		const useCase = new StageIncomingFoodAnnouncement(mockRepo, mockLogger);

		await expect(useCase.execute(validCommand)).resolves.toBeUndefined();

		expect(mockLogger.debug).toHaveBeenCalledWith(
			"Food announcement message already staged, ignoring duplicate",
			{ id: "msg-123" },
		);
		expect(mockLogger.info).not.toHaveBeenCalled();
	});

	it("rethrows unhandled repository errors", async () => {
		const mockRepo = createMockRepo();
		const mockLogger = createMockLogger();
		const dbError = new Error("Connection lost to database");
		vi.mocked(mockRepo.stageMessage).mockRejectedValueOnce(dbError);
		const useCase = new StageIncomingFoodAnnouncement(mockRepo, mockLogger);

		await expect(useCase.execute(validCommand)).rejects.toThrow("Connection lost to database");
	});
});
