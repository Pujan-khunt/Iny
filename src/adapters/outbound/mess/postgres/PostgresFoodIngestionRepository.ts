import type { FoodAnnouncementSource } from "../../../../core/entities/FoodAnnouncement";
import type {
	FoodLease,
	FoodFailure,
	ValidatedFoodCommit,
} from "../../../../core/entities/FoodIngestion";
import type { FoodIngestionRepositoryPort } from "../../../../core/ports/FoodIngestionRepositoryPort";
import { PostgresFoodAdmission } from "./PostgresFoodAdmission";
import { PostgresFoodWorkQueue } from "./PostgresFoodWorkQueue";
import { PostgresFoodFinalizer } from "./PostgresFoodFinalizer";
import type { PostgresMessWriteGuard } from "./PostgresMessWriteGuard";
import type { PostgresMealCommitter } from "./PostgresMealCommitter";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

type Db = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

/** Complete automatic ingestion persistence boundary with injected transaction owners. */
export class PostgresFoodIngestionRepository implements FoodIngestionRepositoryPort {
	/** Injects admission, durable work queue and atomic finalization collaborators. */
	constructor(
		private readonly admission: PostgresFoodAdmission,
		private readonly queue: PostgresFoodWorkQueue,
		private readonly finalizer: PostgresFoodFinalizer,
	) {}

	/** Composes standard postgres persistence collaborators into a ready repository. */
	static create(
		db: Db,
		guard: PostgresMessWriteGuard,
		committer: PostgresMealCommitter,
	): PostgresFoodIngestionRepository {
		return new PostgresFoodIngestionRepository(
			new PostgresFoodAdmission(db),
			new PostgresFoodWorkQueue(db),
			new PostgresFoodFinalizer(db, guard, committer),
		);
	}
	/** Returns the group's persistent activation time; persistence failures reject. */
	initialize(groupJid: string) {
		return this.admission.initialize(groupJid);
	}
	/** Captures a new source and admission atomically; persistence failures reject. */
	capture(source: FoodAnnouncementSource) {
		return this.admission.capture(source);
	}
	/** Claims one admitted source or null; persistence failures reject. */
	claimNext() {
		return this.queue.claimNext();
	}
	/** Commits validated facts and final state together; persistence failures reject. */
	accept(lease: FoodLease, commit: ValidatedFoodCommit) {
		return this.finalizer.accept(lease, commit);
	}
	/** Saves a fenced semantic rejection; persistence failures reject. */
	reject(lease: FoodLease, decision: Parameters<FoodIngestionRepositoryPort["reject"]>[1]) {
		return this.finalizer.reject(lease, decision);
	}
	/** Records a fenced failure or bounded retry; persistence failures reject. */
	fail(lease: FoodLease, failure: FoodFailure) {
		return this.queue.fail(lease, failure);
	}
}
