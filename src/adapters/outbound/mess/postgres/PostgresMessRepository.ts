import { and, eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { MessRepositoryPort, GetMealQuery } from "../../../../core/ports/MessRepositoryPort.js";
import {
	MessMeal,
	MessMealLocationDetail,
	MessMealTimingExtension,
	MessMealChange,
	ResolvedMealInfo,
	MealSlot,
	Vendor,
	MealChangeType,
} from "../../../../core/entities/MessMeal.js";
import { LoggerPort } from "../../../../core/ports/LoggerPort.js";
import {
	messMeals,
	messMealLocationDetails,
	messMealTimingExtensions,
	messMealChanges,
	MessMealRow,
	MessMealLocationDetailRow,
	MessMealTimingExtensionRow,
	MessMealChangeRow,
} from "./schema.js";

/**
 * Outbound adapter implementing MessRepositoryPort backed by PostgreSQL and Drizzle ORM.
 * Executes 4 parallel index-backed point queries via Promise.all across mess operational tables
 * and aggregates them into a composite ResolvedMealInfo domain entity.
 */
export class PostgresMessRepository implements MessRepositoryPort {
	constructor(
		private db: PgDatabase<any, any, any>,
		private logger?: LoggerPort,
	) {}

	/**
	 * Retrieves aggregated mess information (meals, seating locations, timing extensions, changes)
	 * for the given date, optional slot, and optional vendor.
	 */
	async getResolvedMeal(query: GetMealQuery): Promise<ResolvedMealInfo> {
		this.logger?.debug?.("Querying resolved mess meal", { query });

		// 1. Build Query 1: messMeals by mealDate, optional mealSlot, optional vendor
		const mealConditions = [eq(messMeals.mealDate, query.mealDate)];
		if (query.mealSlot) {
			mealConditions.push(eq(messMeals.mealSlot, query.mealSlot));
		}
		if (query.vendor) {
			mealConditions.push(eq(messMeals.vendor, query.vendor));
		}
		const mealsPromise = this.db
			.select()
			.from(messMeals)
			.where(and(...mealConditions)) as Promise<MessMealRow[]>;

		// 2. Build Query 2: messMealLocationDetails by mealDate, optional mealSlot
		const locationConditions = [eq(messMealLocationDetails.mealDate, query.mealDate)];
		if (query.mealSlot) {
			locationConditions.push(eq(messMealLocationDetails.mealSlot, query.mealSlot));
		}
		const locationPromise = this.db
			.select()
			.from(messMealLocationDetails)
			.where(and(...locationConditions)) as Promise<MessMealLocationDetailRow[]>;

		// 3. Build Query 3: messMealTimingExtensions by mealDate, optional mealSlot
		const timingConditions = [eq(messMealTimingExtensions.mealDate, query.mealDate)];
		if (query.mealSlot) {
			timingConditions.push(eq(messMealTimingExtensions.mealSlot, query.mealSlot));
		}
		const timingsPromise = this.db
			.select()
			.from(messMealTimingExtensions)
			.where(and(...timingConditions)) as Promise<MessMealTimingExtensionRow[]>;

		// 4. Build Query 4: messMealChanges by mealDate, optional mealSlot
		const changeConditions = [eq(messMealChanges.mealDate, query.mealDate)];
		if (query.mealSlot) {
			changeConditions.push(eq(messMealChanges.mealSlot, query.mealSlot));
		}
		const changesPromise = this.db
			.select()
			.from(messMealChanges)
			.where(and(...changeConditions)) as Promise<MessMealChangeRow[]>;

		// Execute all 4 queries concurrently in parallel
		const [mealRows, locationRows, timingRows, changeRows] = await Promise.all([
			mealsPromise,
			locationPromise,
			timingsPromise,
			changesPromise,
		]);

		// Map messMeals rows
		const mappedMeals: MessMeal[] = mealRows.map((row) => ({
			id: row.id,
			mealDate: row.mealDate,
			mealSlot: row.mealSlot as MealSlot,
			vendor: row.vendor as Vendor,
			items: Object.freeze([...row.items]),
			sourceMessageId: row.sourceMessageId ?? null,
			ingestedAt: row.ingestedAt,
		}));

		// Map locationDetails row
		let mappedLocationDetail: MessMealLocationDetail | null = null;
		if (locationRows.length > 0) {
			const selectedLocation = query.mealSlot
				? (locationRows.find((r) => r.mealSlot === query.mealSlot) ?? locationRows[0])
				: (locationRows.find((r) => r.mealSlot === "lunch") ?? locationRows[0]);

			if (selectedLocation) {
				mappedLocationDetail = {
					id: selectedLocation.id,
					mealDate: selectedLocation.mealDate,
					mealSlot: selectedLocation.mealSlot as MealSlot,
					hostelBatches: Object.freeze([...selectedLocation.hostelBatches]),
					collegeBatches: Object.freeze([...selectedLocation.collegeBatches]),
					sourceMessageId: selectedLocation.sourceMessageId ?? null,
					ingestedAt: selectedLocation.ingestedAt,
				};
			}
		}

		// Map timingExtensions rows
		const mappedTimingExtensions: MessMealTimingExtension[] = timingRows.map((row) => ({
			id: row.id,
			mealDate: row.mealDate,
			mealSlot: row.mealSlot as MealSlot,
			targetVendor: (row.targetVendor as Vendor) ?? null,
			extendedTimings: row.extendedTimings,
			sourceMessageId: row.sourceMessageId ?? null,
			ingestedAt: row.ingestedAt,
		}));

		// Map mealChanges rows
		const mappedMealChanges: MessMealChange[] = changeRows.map((row) => ({
			id: row.id,
			mealDate: row.mealDate,
			mealSlot: row.mealSlot as MealSlot,
			targetVendor: row.targetVendor as Vendor,
			changeType: row.changeType as MealChangeType,
			affectedItem: row.affectedItem,
			originalItem: row.originalItem ?? null,
			sourceMessageId: row.sourceMessageId ?? null,
			ingestedAt: row.ingestedAt,
		}));

		return {
			mealDate: query.mealDate,
			mealSlot: query.mealSlot ?? null,
			meals: Object.freeze(mappedMeals),
			locationDetail: mappedLocationDetail,
			timingExtensions: Object.freeze(mappedTimingExtensions),
			mealChanges: Object.freeze(mappedMealChanges),
		};
	}
}
