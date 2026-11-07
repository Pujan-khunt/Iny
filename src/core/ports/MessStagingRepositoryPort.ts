import type { MealSlot, Vendor } from "../entities/MessMeal";
import type {
	AtomicCommitCompositeOptions,
	MessIngestionAudit,
	AtomicCommitOptions,
	CommitOperationalPayload,
} from "../entities/MessCommit";

export type {
	CommitMealsInput,
	CommitLocationDetailInput,
	CommitTimingExtensionInput,
	CommitMealChangeInput,
	ResolvedMealSwapInput,
	CommitOperationalPayload,
	AtomicCommitOptions,
	AtomicCommitCompositeOptions,
} from "../entities/MessCommit";

/** Manual staging queue status, independent of automatic ingestion decisions. */
export type StagedMessageStatus = "pending" | "processed" | "ignored";

/**
 * Result of staging an announcement message in the staging repository.
 */
export type StageMessageResult = "staged" | "already_staged";

/** Stored raw announcement available for manual triage. */
export interface StagedAnnouncementMessage {
	id: string;
	senderAddress: string;
	senderAddressType: "pn" | "lid";
	messageType: "image" | "document" | "text";
	mediaMimeType?: string | null;
	mediaBuffer?: Uint8Array | null;
	textBody?: string | null;
	status: StagedMessageStatus;
	receivedAt: Date;
	processedAt?: Date | null;
}

/** Incoming raw announcement with optional repository-generated status and time. */
export interface NewStagedAnnouncementMessage {
	id: string;
	senderAddress: string;
	senderAddressType: "pn" | "lid";
	messageType: "image" | "document" | "text";
	mediaMimeType?: string | null;
	mediaBuffer?: Uint8Array | null;
	textBody?: string | null;
	status?: StagedMessageStatus;
	receivedAt?: Date;
}

/** Optional manual staging inbox filters. */
export interface ListStagedMessagesOptions {
	limit?: number;
	date?: string;
	status?: StagedMessageStatus;
}

/** Existing operational meal snapshot exposed to manual swap resolution. */
export interface StagedMealLookupRecord {
	mealDate: string;
	mealSlot: MealSlot | string;
	vendor: Vendor | string;
	items: string[];
}

/** Port contract for staged announcement messages and atomic transaction operations. */
export interface MessStagingRepositoryPort {
	/** Returns persisted automatic and operation evidence, or null for an unknown message. */
	getIngestionAudit(messageId: string): Promise<MessIngestionAudit | null>;
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
	/** Ignores staging and fences outstanding automatic work without changing terminal decisions. */
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
	/** Restores audited before-images or current-owned legacy rows; changed ownership rejects atomically. */
	atomicUndo(messageId: string): Promise<void>;
	/** Resets operational/staging data for development while preserving automatic activation and final decisions. */
	atomicReset(): Promise<void>;
}
