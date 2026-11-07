import { MealSlot, Vendor } from "../../../../core/entities/MessMeal";
import {
	AtomicCommitCompositeOptions,
	AtomicCommitOptions,
	CommitOperationalPayload,
	ListStagedMessagesOptions,
	MessStagingRepositoryPort,
	NewStagedAnnouncementMessage,
	StagedAnnouncementMessage,
	StagedMealLookupRecord,
	StageMessageResult,
} from "../../../../core/ports/MessStagingRepositoryPort";
import { PostgresMealCommitter } from "./PostgresMealCommitter";
import { PostgresMealRollback } from "./PostgresMealRollback";
import { PostgresStagingQueue } from "./PostgresStagingQueue";

/**
 * Lean coordinator implementing MessStagingRepositoryPort backed by PostgreSQL.
 * Delegates staging queue, transactional commit, and surgical rollback operations
 * to dedicated cohesive submodules.
 */
export class PostgresMessStagingRepository implements MessStagingRepositoryPort {
	/** Receives the queue, guarded committer and explicit rollback collaborators. */
	constructor(
		private readonly queue: PostgresStagingQueue,
		private readonly committer: PostgresMealCommitter,
		private readonly rollback: PostgresMealRollback,
	) {}

	/** Returns persisted decisions and independent operation history, or null if unknown. */
	getIngestionAudit(messageId: string) {
		return this.queue.getIngestionAudit(messageId);
	}

	/** Returns raw staging rows matching optional filters; database failures reject. */
	async listStagedMessages(
		options?: ListStagedMessagesOptions,
	): Promise<StagedAnnouncementMessage[]> {
		return this.queue.listStagedMessages(options);
	}

	/** Captures raw content once by source ID; returns duplicate status or rejects on database failure. */
	async stageMessage(message: NewStagedAnnouncementMessage): Promise<StageMessageResult> {
		return this.queue.stageMessage(message);
	}

	/** Returns the source's raw staging row or null; database failures reject. */
	async getMessageById(id: string): Promise<StagedAnnouncementMessage | null> {
		return this.queue.getMessageById(id);
	}

	/** Ignores the source and fences unfinished automatic work atomically; database failures reject. */
	async markIgnored(id: string): Promise<void> {
		return this.queue.markIgnored(id);
	}

	/** Returns endpoint snapshots for the optional vendor scope; database failures reject. */
	async getMealsByDateAndSlot(
		mealDate: string,
		mealSlot: MealSlot | string,
		vendor?: Vendor | string | null,
	): Promise<StagedMealLookupRecord[]> {
		return this.committer.getMealsByDateAndSlot(mealDate, mealSlot, vendor);
	}

	/** Commits reviewed source values atomically; validation, ordering, or SQL failure rejects. */
	async atomicCommit(options: AtomicCommitOptions): Promise<void>;
	/** Commits a reviewed payload for its staged ID; conflicts and SQL failures reject atomically. */
	async atomicCommit(messageId: string, payload: CommitOperationalPayload): Promise<void>;
	/** Delegates either public request form to the shared guarded committer. */
	async atomicCommit(
		messageIdOrOptions: string | AtomicCommitOptions,
		maybePayload?: CommitOperationalPayload,
	): Promise<void> {
		if (typeof messageIdOrOptions === "string") {
			return this.committer.atomicCommit(messageIdOrOptions, maybePayload ?? {});
		}
		return this.committer.atomicCommit(messageIdOrOptions);
	}

	/** Commits all reviewed clauses and resolved swaps; any failed prerequisite rejects all writes. */
	async atomicCommitComposite(options: AtomicCommitCompositeOptions): Promise<void> {
		return this.committer.atomicCommitComposite(options);
	}

	/** Restores this source's owned before-images; changed ownership or SQL failure rejects atomically. */
	async atomicUndo(messageId: string): Promise<void> {
		return this.rollback.atomicUndo(messageId);
	}

	/** Clears development meal data while preserving final decisions; database failures reject. */
	async atomicReset(): Promise<void> {
		return this.rollback.atomicReset();
	}
}
