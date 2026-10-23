/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type {
	CommitLocationDetailInput,
	CommitMealChangeInput,
	CommitMealsInput,
	CommitOperationalPayload,
	CommitTimingExtensionInput,
} from "../../../../core/ports/MessStagingRepositoryPort";
import {
	messMeals,
	messMealLocationDetails,
	messMealTimingExtensions,
	messMealChanges,
	whatsappGroupFoodAnnouncementsMessages,
} from "./schema";

const asList = <T>(v?: T | T[]): T[] => (!v ? [] : Array.isArray(v) ? v : [v]);
const resolveMeals = (p: CommitOperationalPayload): CommitMealsInput[] => [
	...(p.weeklyMenu?.meals ?? []).map((m) => ({
		mealDate: m.mealDate,
		mealSlot: m.mealSlot,
		vendor: p.weeklyMenu!.vendor,
		items: m.items,
	})),
	...(p.meals ?? []).map((m) => ({ ...m, vendor: m.vendor ?? p.vendor })),
];

/** Low-level row persistence operations for operational mess entities during atomic commits. */
export class PostgresOperationalWriter {
	async commitMeals(tx: any, messageId: string, payload: CommitOperationalPayload): Promise<void> {
		for (const m of resolveMeals(payload)) {
			if (!m.vendor) {
				throw new Error(
					`Missing vendor for meal on ${m.mealDate} slot ${m.mealSlot}. A vendor is required.`,
				);
			}
			const row = {
				id: m.id ?? crypto.randomUUID(),
				mealDate: m.mealDate,
				mealSlot: m.mealSlot,
				vendor: m.vendor,
				items: Array.from(m.items),
				sourceMessageId: messageId,
				ingestedAt: new Date(),
			};
			await tx
				.insert(messMeals)
				.values(row)
				.onConflictDoUpdate({
					target: [messMeals.mealDate, messMeals.mealSlot, messMeals.vendor],
					set: { items: row.items, sourceMessageId: messageId, ingestedAt: new Date() },
				});
		}
	}

	async commitLocations(
		tx: any,
		messageId: string,
		input?: CommitLocationDetailInput | CommitLocationDetailInput[],
	): Promise<void> {
		for (const loc of asList(input)) {
			const row = {
				id: loc.id ?? crypto.randomUUID(),
				mealDate: loc.mealDate,
				mealSlot: loc.mealSlot ?? "lunch",
				hostelBatches: Array.from(loc.hostelBatches),
				collegeBatches: Array.from(loc.collegeBatches),
				sourceMessageId: messageId,
				ingestedAt: new Date(),
			};
			await tx
				.insert(messMealLocationDetails)
				.values(row)
				.onConflictDoUpdate({
					target: [messMealLocationDetails.mealDate, messMealLocationDetails.mealSlot],
					set: {
						hostelBatches: row.hostelBatches,
						collegeBatches: row.collegeBatches,
						sourceMessageId: messageId,
						ingestedAt: new Date(),
					},
				});
		}
	}

	async commitTimings(
		tx: any,
		messageId: string,
		input?: CommitTimingExtensionInput | CommitTimingExtensionInput[],
	): Promise<void> {
		const rows = asList(input).map((t) => ({
			id: t.id ?? crypto.randomUUID(),
			mealDate: t.mealDate,
			mealSlot: t.mealSlot,
			targetVendor: t.targetVendor ?? null,
			extendedTimings: t.extendedTimings,
			sourceMessageId: messageId,
			ingestedAt: new Date(),
		}));
		if (rows.length > 0) await tx.insert(messMealTimingExtensions).values(rows);
	}

	async commitChanges(
		tx: any,
		messageId: string,
		input?: CommitMealChangeInput | CommitMealChangeInput[],
	): Promise<void> {
		const rows = asList(input).map((c) => ({
			id: c.id ?? crypto.randomUUID(),
			mealDate: c.mealDate,
			mealSlot: c.mealSlot,
			targetVendor: c.targetVendor,
			changeType: c.changeType,
			affectedItem: c.affectedItem,
			originalItem: c.originalItem ?? null,
			sourceMessageId: messageId,
			ingestedAt: new Date(),
		}));
		if (rows.length > 0) await tx.insert(messMealChanges).values(rows);
	}

	async markProcessed(tx: any, messageId: string): Promise<void> {
		await tx
			.update(whatsappGroupFoodAnnouncementsMessages)
			.set({ status: "processed", processedAt: new Date() })
			.where(eq(whatsappGroupFoodAnnouncementsMessages.id, messageId));
	}
}
