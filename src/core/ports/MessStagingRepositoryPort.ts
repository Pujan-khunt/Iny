import { MealSlot, Vendor, MealChangeType } from "../entities/MessMeal";

export type StagedMessageStatus = "pending" | "processed" | "ignored";

/**
 * Result of staging an announcement message in the staging repository.
 */
export type StageMessageResult = "staged" | "already_staged";

export interface StagedAnnouncementMessage {
	id: string;
	senderAddress: string;
	senderAddressType: "pn" | "lid";
	messageType: "image" | "document" | "text";
	mediaMimeType?: string | null;
	mediaBuffer?: Buffer | Uint8Array | null;
	textBody?: string | null;
	status: StagedMessageStatus;
	receivedAt: Date;
	processedAt?: Date | null;
}

export interface NewStagedAnnouncementMessage {
	id: string;
	senderAddress: string;
	senderAddressType: "pn" | "lid";
	messageType: "image" | "document" | "text";
	mediaMimeType?: string | null;
	mediaBuffer?: Buffer | Uint8Array | null;
	textBody?: string | null;
	status?: StagedMessageStatus;
	receivedAt?: Date;
}

export interface ListStagedMessagesOptions {
	limit?: number;
	date?: string;
	status?: StagedMessageStatus;
}

export interface CommitMealsInput {
	id?: string;
	mealDate: string;
	mealSlot: MealSlot;
	vendor?: Vendor;
	items: readonly string[] | string[];
}

export interface CommitLocationDetailInput {
	id?: string;
	mealDate: string;
	mealSlot?: MealSlot;
	hostelBatches: readonly string[] | string[];
	collegeBatches: readonly string[] | string[];
}

export interface CommitTimingExtensionInput {
	id?: string;
	mealDate: string;
	mealSlot: MealSlot;
	targetVendor?: Vendor | null;
	extendedTimings: string;
}

export interface CommitMealChangeInput {
	id?: string;
	mealDate: string;
	mealSlot: MealSlot;
	targetVendor: Vendor;
	changeType: MealChangeType;
	affectedItem: string;
	originalItem?: string | null;
}

export interface StagedWeeklyMealItem {
	mealDate: string;
	mealSlot: MealSlot;
	items: string[];
}

export interface StagedWeeklyMenu {
	vendor: Vendor;
	meals: StagedWeeklyMealItem[];
}

export interface StagedMealSwap {
	targetMealDate: string;
	targetMealSlot: MealSlot;
	sourceMealDate: string;
	sourceMealSlot: MealSlot;
	targetVendor?: Vendor | null;
}

export interface StagedCompositeAnnouncement {
	mealDate: string;
	location?: CommitLocationDetailInput | null;
	timingExtensions?: CommitTimingExtensionInput[];
	mealChanges?: CommitMealChangeInput[];
	mealSwaps?: StagedMealSwap[];
}

export interface ResolvedMealSwapInput {
	targetMealDate: string;
	targetMealSlot: MealSlot;
	vendor: Vendor;
	newItems: string[];
	previousItems: string[];
	sourceMealDate: string;
	sourceMealSlot: MealSlot;
}

export interface CommitOperationalPayload {
	vendor?: Vendor;
	meals?: CommitMealsInput[];
	weeklyMenu?: StagedWeeklyMenu;
	locationDetails?: CommitLocationDetailInput | CommitLocationDetailInput[];
	locationDetail?: CommitLocationDetailInput;
	timingExtensions?: CommitTimingExtensionInput | CommitTimingExtensionInput[];
	timingExtension?: CommitTimingExtensionInput;
	mealChanges?: CommitMealChangeInput | CommitMealChangeInput[];
	mealChange?: CommitMealChangeInput;
}

export type AtomicCommitOptions = CommitOperationalPayload & { messageId: string };

export interface AtomicCommitCompositeOptions {
	messageId: string;
	composite: StagedCompositeAnnouncement;
	resolvedSwaps?: ResolvedMealSwapInput[];
}

export interface StagedMealLookupRecord {
	mealDate: string;
	mealSlot: MealSlot | string;
	vendor: Vendor | string;
	items: string[];
}

/** Port contract for staged announcement messages and atomic transaction operations. */
export interface MessStagingRepositoryPort {
	/** Lists staged messages filtered by options. */
	listStagedMessages(options?: ListStagedMessagesOptions): Promise<StagedAnnouncementMessage[]>;
	/** Retrieves a staged message by its unique identifier. */
	getMessageById(id: string): Promise<StagedAnnouncementMessage | null>;
	/**
	 * Stages an incoming food announcement message.
	 *
	 * @param message Message payload to stage.
	 * @returns "staged" if newly inserted, or "already_staged" if duplicate exists.
	 */
	stageMessage(message: NewStagedAnnouncementMessage): Promise<StageMessageResult>;
	/** Marks a staged message as ignored. */
	markIgnored(id: string): Promise<void>;
	/** Retrieves operational mess meals for date, slot, and optional vendor. */
	getMealsByDateAndSlot(
		mealDate: string,
		mealSlot: MealSlot | string,
		vendor?: Vendor | string | null,
	): Promise<StagedMealLookupRecord[]>;
	/** Atomically commits operational payload and updates message status. */
	atomicCommit(options: AtomicCommitOptions): Promise<void>;
	atomicCommit(messageId: string, payload: CommitOperationalPayload): Promise<void>;
	/** Atomically commits composite operational announcements. */
	atomicCommitComposite(options: AtomicCommitCompositeOptions): Promise<void>;
	/** Surgically reverts operational rows created from a specific message. */
	atomicUndo(messageId: string): Promise<void>;
	/** Resets staging and operational mess tables for testing or development. */
	atomicReset(): Promise<void>;
}
