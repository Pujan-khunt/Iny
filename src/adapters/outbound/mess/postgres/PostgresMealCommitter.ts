/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq, type SQL } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { LoggerPort } from "../../../../core/ports/LoggerPort";
import { MealSlot, Vendor } from "../../../../core/entities/MessMeal";
import {
	AtomicCommitCompositeOptions,
	AtomicCommitOptions,
	CommitOperationalPayload,
	StagedMealLookupRecord,
} from "../../../../core/ports/MessStagingRepositoryPort";
import { PostgresOperationalWriter } from "./PostgresOperationalWriter";
import { PostgresSwapWriter } from "./PostgresSwapWriter";
import { messMeals, type MessMealRow } from "./schema";

/** Handles atomic transactional commit operations for operational mess entities. */
export class PostgresMealCommitter {
	private readonly writer: PostgresOperationalWriter;
	private readonly swapWriter: PostgresSwapWriter;

	constructor(
		private readonly db: PgDatabase<any, any, any>,
		private readonly logger: LoggerPort,
	) {
		this.writer = new PostgresOperationalWriter();
		this.swapWriter = new PostgresSwapWriter();
	}

	async getMealsByDateAndSlot(
		mealDate: string,
		mealSlot: MealSlot | string,
		vendor?: Vendor | string | null,
	): Promise<StagedMealLookupRecord[]> {
		this.logger.debug("Fetching mess meals by date and slot", { mealDate, mealSlot, vendor });
		const conditions: SQL[] = [
			eq(messMeals.mealDate, mealDate),
			eq(messMeals.mealSlot, mealSlot as any),
		];
		if (vendor) conditions.push(eq(messMeals.vendor, vendor as any));
		const rows = (await this.db
			.select()
			.from(messMeals)
			.where(and(...conditions))) as MessMealRow[];
		return rows.map((r) => ({
			mealDate: r.mealDate,
			mealSlot: r.mealSlot,
			vendor: r.vendor,
			items: r.items,
		}));
	}

	async atomicCommit(options: AtomicCommitOptions): Promise<void>;
	async atomicCommit(messageId: string, payload: CommitOperationalPayload): Promise<void>;
	async atomicCommit(
		messageIdOrOptions: string | AtomicCommitOptions,
		maybePayload?: CommitOperationalPayload,
	): Promise<void> {
		const messageId =
			typeof messageIdOrOptions === "string" ? messageIdOrOptions : messageIdOrOptions.messageId;
		const payload =
			typeof messageIdOrOptions === "string" ? (maybePayload ?? {}) : messageIdOrOptions;

		this.logger.info("Executing atomic commit for message", { messageId });
		await this.db.transaction(async (tx) => {
			await this.writer.commitMeals(tx, messageId, payload);
			await this.writer.commitLocations(
				tx,
				messageId,
				payload.locationDetails ?? payload.locationDetail,
			);
			await this.writer.commitTimings(
				tx,
				messageId,
				payload.timingExtensions ?? payload.timingExtension,
			);
			await this.writer.commitChanges(tx, messageId, payload.mealChanges ?? payload.mealChange);
			await this.writer.markProcessed(tx, messageId);
		});
		this.logger.info("Successfully committed staging message", { messageId });
	}

	async atomicCommitComposite(options: AtomicCommitCompositeOptions): Promise<void> {
		const { messageId, composite, resolvedSwaps } = options;
		this.logger.info("Executing atomic composite commit for message", { messageId });
		await this.db.transaction(async (tx) => {
			await this.writer.commitLocations(tx, messageId, composite.location ?? undefined);
			await this.writer.commitTimings(tx, messageId, composite.timingExtensions);
			await this.writer.commitChanges(tx, messageId, composite.mealChanges);
			await this.swapWriter.commitSwaps(tx, messageId, resolvedSwaps);
			await this.writer.markProcessed(tx, messageId);
		});
		this.logger.info("Successfully committed composite announcement", { messageId });
	}
}
