import type { PgDatabase } from "drizzle-orm/pg-core";
import { LoggerPort } from "../../../../core/ports/LoggerPort";
import { MealSlot, Vendor } from "../../../../core/entities/MessMeal";
import {
	AtomicCommitCompositeOptions,
	AtomicCommitOptions,
	CommitLocationDetailInput,
	CommitMealChangeInput,
	CommitMealsInput,
	CommitOperationalPayload,
	CommitTimingExtensionInput,
	ListStagedMessagesOptions,
	MessStagingRepositoryPort,
	NewStagedAnnouncementMessage,
	ResolvedMealSwapInput,
	StagedAnnouncementMessage,
	StagedMealLookupRecord,
} from "../../../../core/ports/MessStagingRepositoryPort";
import { PostgresMealCommitter } from "./PostgresMealCommitter";
import { PostgresMealRollback } from "./PostgresMealRollback";
import { PostgresStagingQueue } from "./PostgresStagingQueue";

export type {
	AtomicCommitCompositeOptions,
	AtomicCommitOptions,
	CommitLocationDetailInput,
	CommitMealChangeInput,
	CommitMealsInput,
	CommitOperationalPayload,
	CommitTimingExtensionInput,
	ListStagedMessagesOptions,
	NewStagedAnnouncementMessage,
	ResolvedMealSwapInput,
	StagedAnnouncementMessage,
	StagedMealLookupRecord,
};

/**
 * Lean coordinator implementing MessStagingRepositoryPort backed by PostgreSQL.
 * Delegates staging queue, transactional commit, and surgical rollback operations
 * to dedicated cohesive submodules.
 */
export class PostgresMessStagingRepository implements MessStagingRepositoryPort {
	private readonly queue: PostgresStagingQueue;
	private readonly committer: PostgresMealCommitter;
	private readonly rollback: PostgresMealRollback;

	constructor(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		private readonly db: PgDatabase<any, any, any>,
		private readonly logger: LoggerPort,
	) {
		this.queue = new PostgresStagingQueue(this.db, this.logger);
		this.committer = new PostgresMealCommitter(this.db, this.logger);
		this.rollback = new PostgresMealRollback(this.db, this.logger);
	}

	async listStagedMessages(
		options?: ListStagedMessagesOptions,
	): Promise<StagedAnnouncementMessage[]> {
		return this.queue.listStagedMessages(options);
	}

	async stageMessage(message: NewStagedAnnouncementMessage): Promise<void> {
		return this.queue.stageMessage(message);
	}

	async getMessageById(id: string): Promise<StagedAnnouncementMessage | null> {
		return this.queue.getMessageById(id);
	}

	async markIgnored(id: string): Promise<void> {
		return this.queue.markIgnored(id);
	}

	async getMealsByDateAndSlot(
		mealDate: string,
		mealSlot: MealSlot | string,
		vendor?: Vendor | string | null,
	): Promise<StagedMealLookupRecord[]> {
		return this.committer.getMealsByDateAndSlot(mealDate, mealSlot, vendor);
	}

	async atomicCommit(options: AtomicCommitOptions): Promise<void>;
	async atomicCommit(messageId: string, payload: CommitOperationalPayload): Promise<void>;
	async atomicCommit(
		messageIdOrOptions: string | AtomicCommitOptions,
		maybePayload?: CommitOperationalPayload,
	): Promise<void> {
		if (typeof messageIdOrOptions === "string") {
			return this.committer.atomicCommit(messageIdOrOptions, maybePayload ?? {});
		}
		return this.committer.atomicCommit(messageIdOrOptions);
	}

	async atomicCommitComposite(options: AtomicCommitCompositeOptions): Promise<void> {
		return this.committer.atomicCommitComposite(options);
	}

	async atomicUndo(messageId: string): Promise<void> {
		return this.rollback.atomicUndo(messageId);
	}

	async atomicReset(): Promise<void> {
		return this.rollback.atomicReset();
	}
}
