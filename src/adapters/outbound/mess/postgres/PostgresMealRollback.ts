import { and, eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { LoggerPort } from "../../../../core/ports/LoggerPort";
import {
	messMeals,
	messMealLocationDetails,
	messMealTimingExtensions,
	messMealChanges,
	whatsappGroupFoodAnnouncementsMessages,
	type MessMealChangeRow,
} from "./schema";

/** Handles atomic surgical undo and development reset operations. */
export class PostgresMealRollback {
	constructor(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		private readonly db: PgDatabase<any, any, any>,
		private readonly logger: LoggerPort,
	) {}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private async restoreSwappedMeal(tx: any, change: MessMealChangeRow): Promise<void> {
		if (!change.originalItem?.startsWith("[")) return;
		try {
			const previousItems = JSON.parse(change.originalItem);
			if (!Array.isArray(previousItems)) return;
			await tx
				.update(messMeals)
				.set({ items: previousItems })
				.where(
					and(
						eq(messMeals.mealDate, change.mealDate),
						eq(messMeals.mealSlot, change.mealSlot),
						eq(messMeals.vendor, change.targetVendor),
					),
				);
		} catch (e) {
			this.logger.warn("Failed to parse originalItem for swap undo", {
				changeId: change.id,
				originalItem: change.originalItem,
				error: e,
			});
		}
	}

	/**
	 * Surgically reverts operational rows created from a specific message,
	 * restores any swapped meals, and sets the staging message status back to 'pending'.
	 */
	async atomicUndo(messageId: string): Promise<void> {
		this.logger.info("Executing surgical undo for message", { messageId });

		await this.db.transaction(async (tx) => {
			const changes = (await tx
				.select()
				.from(messMealChanges)
				.where(eq(messMealChanges.sourceMessageId, messageId))) as MessMealChangeRow[];

			for (const change of changes) {
				await this.restoreSwappedMeal(tx, change);
			}

			await tx.delete(messMeals).where(eq(messMeals.sourceMessageId, messageId));
			await tx
				.delete(messMealLocationDetails)
				.where(eq(messMealLocationDetails.sourceMessageId, messageId));
			await tx
				.delete(messMealTimingExtensions)
				.where(eq(messMealTimingExtensions.sourceMessageId, messageId));
			await tx.delete(messMealChanges).where(eq(messMealChanges.sourceMessageId, messageId));

			await tx
				.update(whatsappGroupFoodAnnouncementsMessages)
				.set({ status: "pending", processedAt: null })
				.where(eq(whatsappGroupFoodAnnouncementsMessages.id, messageId));
		});

		this.logger.info("Successfully completed surgical undo", { messageId });
	}

	/**
	 * Atomically resets operational mess tables and restores all staged announcement messages
	 * to status = 'pending', processedAt = null.
	 */
	async atomicReset(): Promise<void> {
		this.logger.warn("Executing atomic reset across mess operational and staging tables");

		await this.db.transaction(async (tx) => {
			await tx.delete(messMeals);
			await tx.delete(messMealLocationDetails);
			await tx.delete(messMealTimingExtensions);
			await tx.delete(messMealChanges);

			await tx.update(whatsappGroupFoodAnnouncementsMessages).set({
				status: "pending",
				processedAt: null,
			});
		});

		this.logger.info("Successfully completed atomic reset");
	}
}
