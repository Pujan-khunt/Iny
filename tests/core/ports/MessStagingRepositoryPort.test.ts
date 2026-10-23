import { describe, it, expect, vi } from "vitest";
import {
	MessStagingRepositoryPort,
	StagedMessageStatus,
	StagedAnnouncementMessage,
	NewStagedAnnouncementMessage,
	ListStagedMessagesOptions,
	CommitMealsInput,
	CommitLocationDetailInput,
	CommitTimingExtensionInput,
	CommitMealChangeInput,
	StagedWeeklyMealItem,
	StagedWeeklyMenu,
	StagedMealSwap,
	StagedCompositeAnnouncement,
	ResolvedMealSwapInput,
	StagedMealLookupRecord,
	CommitOperationalPayload,
	AtomicCommitOptions,
	AtomicCommitCompositeOptions,
} from "../../../src/core/ports/MessStagingRepositoryPort";

class MockMessStagingRepository implements MessStagingRepositoryPort {
	listStagedMessages =
		vi.fn<(options?: ListStagedMessagesOptions) => Promise<StagedAnnouncementMessage[]>>();
	getMessageById = vi.fn<(id: string) => Promise<StagedAnnouncementMessage | null>>();
	stageMessage = vi.fn<(message: NewStagedAnnouncementMessage) => Promise<void>>();
	markIgnored = vi.fn<(id: string) => Promise<void>>();
	getMealsByDateAndSlot =
		vi.fn<(mealDate: string, mealSlot: any, vendor?: any) => Promise<StagedMealLookupRecord[]>>();
	atomicCommit = vi.fn();
	atomicCommitComposite = vi.fn<(options: AtomicCommitCompositeOptions) => Promise<void>>();
	atomicUndo = vi.fn<(messageId: string) => Promise<void>>();
	atomicReset = vi.fn<() => Promise<void>>();
}

describe("MessStagingRepositoryPort", () => {
	it("verifies module exists and exports contracts", async () => {
		const mod = await import("../../../src/core/ports/MessStagingRepositoryPort");
		expect(mod).toBeDefined();
	});

	it("implements all port contracts with matching parameter and return types", async () => {
		const repo = new MockMessStagingRepository();

		const sampleMessage: StagedAnnouncementMessage = {
			id: "msg-123",
			senderAddress: "919876543210@s.whatsapp.net",
			senderAddressType: "pn",
			messageType: "image",
			mediaMimeType: "image/jpeg",
			mediaBuffer: Buffer.from("dummy-media"),
			textBody: "Special dinner menu for tonight",
			status: "pending" as StagedMessageStatus,
			receivedAt: new Date("2026-10-21T18:00:00.000Z"),
			processedAt: null,
		};

		const sampleNewMessage: NewStagedAnnouncementMessage = {
			id: "msg-124",
			senderAddress: "919876543211@s.whatsapp.net",
			senderAddressType: "pn",
			messageType: "text",
			textBody: "Hostel dinner timing extended",
		};

		const listOptions: ListStagedMessagesOptions = {
			limit: 5,
			date: "2026-10-21",
			status: "pending",
		};

		const mealsInput: CommitMealsInput = {
			mealDate: "2026-10-21",
			mealSlot: "dinner",
			vendor: "cheftalk_regular",
			items: ["Paneer Butter Masala", "Roti"],
		};

		const locationInput: CommitLocationDetailInput = {
			mealDate: "2026-10-21",
			mealSlot: "lunch",
			hostelBatches: ["Batch A"],
			collegeBatches: ["UG 1"],
		};

		const timingInput: CommitTimingExtensionInput = {
			mealDate: "2026-10-21",
			mealSlot: "dinner",
			targetVendor: "tcb",
			extendedTimings: "22:00-23:00",
		};

		const changeInput: CommitMealChangeInput = {
			mealDate: "2026-10-21",
			mealSlot: "dinner",
			targetVendor: "cheftalk_regular",
			changeType: "replacement",
			affectedItem: "Dal Makhani",
			originalItem: "Dal Tadka",
		};

		const weeklyMeal: StagedWeeklyMealItem = {
			mealDate: "2026-10-21",
			mealSlot: "lunch",
			items: ["Rice", "Sambar"],
		};

		const weeklyMenu: StagedWeeklyMenu = {
			vendor: "cheftalk_regular",
			meals: [weeklyMeal],
		};

		const swap: StagedMealSwap = {
			targetMealDate: "2026-10-22",
			targetMealSlot: "lunch",
			sourceMealDate: "2026-10-21",
			sourceMealSlot: "lunch",
			targetVendor: "cheftalk_regular",
		};

		const composite: StagedCompositeAnnouncement = {
			mealDate: "2026-10-21",
			location: locationInput,
			timingExtensions: [timingInput],
			mealChanges: [changeInput],
			mealSwaps: [swap],
		};

		const resolvedSwap: ResolvedMealSwapInput = {
			targetMealDate: "2026-10-22",
			targetMealSlot: "lunch",
			vendor: "cheftalk_regular",
			newItems: ["Paneer"],
			previousItems: ["Aloo"],
			sourceMealDate: "2026-10-21",
			sourceMealSlot: "lunch",
		};

		const payload: CommitOperationalPayload = {
			meals: [mealsInput],
			weeklyMenu,
			locationDetail: locationInput,
			timingExtension: timingInput,
			mealChange: changeInput,
		};

		const atomicOptions: AtomicCommitOptions = {
			...payload,
			messageId: "msg-123",
		};

		const atomicCompositeOptions: AtomicCommitCompositeOptions = {
			messageId: "msg-123",
			composite,
			resolvedSwaps: [resolvedSwap],
		};

		repo.listStagedMessages.mockResolvedValue([sampleMessage]);
		repo.getMessageById.mockResolvedValue(sampleMessage);
		repo.stageMessage.mockResolvedValue(undefined);
		repo.markIgnored.mockResolvedValue(undefined);
		repo.getMealsByDateAndSlot.mockResolvedValue([]);
		repo.atomicCommit.mockResolvedValue(undefined);
		repo.atomicCommitComposite.mockResolvedValue(undefined);
		repo.atomicUndo.mockResolvedValue(undefined);
		repo.atomicReset.mockResolvedValue(undefined);

		// Execute and verify listStagedMessages
		const messages = await repo.listStagedMessages(listOptions);
		expect(messages).toEqual([sampleMessage]);
		expect(repo.listStagedMessages).toHaveBeenCalledWith(listOptions);

		// Execute and verify getMessageById
		const message = await repo.getMessageById("msg-123");
		expect(message).toEqual(sampleMessage);
		expect(repo.getMessageById).toHaveBeenCalledWith("msg-123");

		// Execute and verify stageMessage
		await repo.stageMessage(sampleNewMessage);
		expect(repo.stageMessage).toHaveBeenCalledWith(sampleNewMessage);

		// Execute and verify markIgnored
		await repo.markIgnored("msg-123");
		expect(repo.markIgnored).toHaveBeenCalledWith("msg-123");

		// Execute and verify getMealsByDateAndSlot
		const mealsLookup = await repo.getMealsByDateAndSlot("2026-10-21", "lunch", "cheftalk_regular");
		expect(mealsLookup).toEqual([]);
		expect(repo.getMealsByDateAndSlot).toHaveBeenCalledWith(
			"2026-10-21",
			"lunch",
			"cheftalk_regular",
		);

		// Execute and verify atomicCommit (options overload)
		await repo.atomicCommit(atomicOptions);
		expect(repo.atomicCommit).toHaveBeenCalledWith(atomicOptions);

		// Execute and verify atomicCommit (messageId + payload overload)
		await repo.atomicCommit("msg-123", payload);
		expect(repo.atomicCommit).toHaveBeenCalledWith("msg-123", payload);

		// Execute and verify atomicCommitComposite
		await repo.atomicCommitComposite(atomicCompositeOptions);
		expect(repo.atomicCommitComposite).toHaveBeenCalledWith(atomicCompositeOptions);

		// Execute and verify atomicUndo
		await repo.atomicUndo("msg-123");
		expect(repo.atomicUndo).toHaveBeenCalledWith("msg-123");

		// Execute and verify atomicReset
		await repo.atomicReset();
		expect(repo.atomicReset).toHaveBeenCalled();
	});
});
