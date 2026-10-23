/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { ResolvedMealSwapInput } from "../../../../core/ports/MessStagingRepositoryPort";
import { messMeals, messMealChanges } from "./schema";

/** Handles applying resolved meal swaps and creating surgical undo backups. */
export class PostgresSwapWriter {
	async commitSwaps(tx: any, messageId: string, swaps?: ResolvedMealSwapInput[]): Promise<void> {
		for (const s of swaps ?? []) {
			if (!s.previousItems?.length) {
				throw new Error(
					`Cannot commit swap for ${s.targetMealDate} ${s.targetMealSlot} (${s.vendor}): previousItems backup must not be empty.`,
				);
			}
			await tx
				.update(messMeals)
				.set({ items: Array.from(s.newItems) })
				.where(
					and(
						eq(messMeals.mealDate, s.targetMealDate),
						eq(messMeals.mealSlot, s.targetMealSlot),
						eq(messMeals.vendor, s.vendor),
					),
				);
			await tx.insert(messMealChanges).values({
				id: crypto.randomUUID(),
				mealDate: s.targetMealDate,
				mealSlot: s.targetMealSlot,
				targetVendor: s.vendor,
				changeType: "replacement",
				affectedItem: `${s.sourceMealDate} ${s.sourceMealSlot} Menu (${s.newItems.join(", ")})`,
				originalItem: JSON.stringify(Array.from(s.previousItems)),
				sourceMessageId: messageId,
				ingestedAt: new Date(),
			});
		}
	}
}
