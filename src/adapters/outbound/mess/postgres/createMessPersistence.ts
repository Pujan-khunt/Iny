import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { LoggerPort } from "../../../../core/ports/LoggerPort";
import { PostgresMessProvenance } from "./PostgresMessProvenance";
import { PostgresMessOperationAudit } from "./PostgresMessOperationAudit";
import { PostgresMessWriteGuard } from "./PostgresMessWriteGuard";
import { PostgresOperationalWriter } from "./PostgresOperationalWriter";
import { PostgresSwapWriter } from "./PostgresSwapWriter";
import { PostgresMessCommitPreparation } from "./PostgresMessCommitPreparation";
import { PostgresMealCommitter } from "./PostgresMealCommitter";
import { PostgresFoodIngestionRepository } from "./PostgresFoodIngestionRepository";
import { PostgresMessAuditRestorer } from "./PostgresMessAuditRestorer";
import { PostgresMealRollback } from "./PostgresMealRollback";
import { PostgresStagingQueue } from "./PostgresStagingQueue";
import { PostgresMessStagingRepository } from "./PostgresMessStagingRepository";

type Db = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

/** Assembles the internal mess persistence collaborators into public staging and food repositories. */
export function createMessPersistence(
	db: Db,
	logger: LoggerPort,
): {
	food: PostgresFoodIngestionRepository;
	staging: PostgresMessStagingRepository;
} {
	const audit = new PostgresMessOperationAudit(new PostgresMessProvenance()),
		guard = new PostgresMessWriteGuard(audit);
	const committer = new PostgresMealCommitter(
		db,
		logger.child({ module: "mess-staging" }),
		new PostgresOperationalWriter(),
		new PostgresSwapWriter(),
		guard,
		audit,
		new PostgresMessCommitPreparation(),
	);
	const food = PostgresFoodIngestionRepository.create(db, guard, committer);
	const rollback = new PostgresMealRollback(
		db,
		logger,
		guard,
		new PostgresMessAuditRestorer(audit),
		audit,
	);
	const staging = new PostgresMessStagingRepository(
		new PostgresStagingQueue(db, logger, guard, audit),
		committer,
		rollback,
	);
	return { food, staging };
}
