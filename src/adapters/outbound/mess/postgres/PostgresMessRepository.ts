import { and, eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { MessRepositoryPort, GetMealQuery } from "../../../../core/ports/MessRepositoryPort";
import type {
	MessMeal,
	MessMealLocationDetail,
	MessMealTimingExtension,
	MessMealChange,
	ResolvedMealInfo,
	MealSlot,
	Vendor,
	MealChangeType,
} from "../../../../core/entities/MessMeal";
import { LoggerPort } from "../../../../core/ports/LoggerPort";
import {
	messMeals,
	messMealLocationDetails,
	messMealTimingExtensions,
	messMealChanges,
	MessMealRow,
	MessMealLocationDetailRow,
	MessMealTimingExtensionRow,
	MessMealChangeRow,
} from "./schema";

/** Outbound adapter implementing MessRepositoryPort backed by PostgreSQL and Drizzle ORM. */
export class PostgresMessRepository implements MessRepositoryPort {
	constructor(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		private readonly db: PgDatabase<any, any, any>,
		private readonly logger: LoggerPort,
	) {}

	async getResolvedMeal(query: GetMealQuery): Promise<ResolvedMealInfo> {
		this.logger.debug("Querying resolved mess meal", { query });
		const [mealRows, locationRows, timingRows, changeRows] = await Promise.all([
			this.fetchMeals(query),
			this.fetchLocations(query),
			this.fetchTimings(query),
			this.fetchChanges(query),
		]);
		return {
			mealDate: query.mealDate,
			mealSlot: query.mealSlot ?? null,
			meals: Object.freeze(this.mapMeals(mealRows)),
			locationDetail: this.mapLocationDetail(locationRows, query.mealSlot),
			timingExtensions: Object.freeze(this.mapTimingExtensions(timingRows)),
			mealChanges: Object.freeze(this.mapMealChanges(changeRows)),
		};
	}

	private async fetchMeals(query: GetMealQuery): Promise<MessMealRow[]> {
		const conditions = [eq(messMeals.mealDate, query.mealDate)];
		if (query.mealSlot) conditions.push(eq(messMeals.mealSlot, query.mealSlot));
		if (query.vendor) conditions.push(eq(messMeals.vendor, query.vendor));
		return (await this.db
			.select()
			.from(messMeals)
			.where(and(...conditions))) as MessMealRow[];
	}

	private async fetchLocations(query: GetMealQuery): Promise<MessMealLocationDetailRow[]> {
		const conditions = [eq(messMealLocationDetails.mealDate, query.mealDate)];
		if (query.mealSlot) conditions.push(eq(messMealLocationDetails.mealSlot, query.mealSlot));
		return (await this.db
			.select()
			.from(messMealLocationDetails)
			.where(and(...conditions))) as MessMealLocationDetailRow[];
	}

	private async fetchTimings(query: GetMealQuery): Promise<MessMealTimingExtensionRow[]> {
		const conditions = [eq(messMealTimingExtensions.mealDate, query.mealDate)];
		if (query.mealSlot) conditions.push(eq(messMealTimingExtensions.mealSlot, query.mealSlot));
		return (await this.db
			.select()
			.from(messMealTimingExtensions)
			.where(and(...conditions))) as MessMealTimingExtensionRow[];
	}

	private async fetchChanges(query: GetMealQuery): Promise<MessMealChangeRow[]> {
		const conditions = [eq(messMealChanges.mealDate, query.mealDate)];
		if (query.mealSlot) conditions.push(eq(messMealChanges.mealSlot, query.mealSlot));
		return (await this.db
			.select()
			.from(messMealChanges)
			.where(and(...conditions))) as MessMealChangeRow[];
	}

	private mapMeals(rows: MessMealRow[]): MessMeal[] {
		return rows.map((r) => ({
			id: r.id,
			mealDate: r.mealDate,
			mealSlot: r.mealSlot as MealSlot,
			vendor: r.vendor as Vendor,
			items: Object.freeze([...r.items]),
			sourceMessageId: r.sourceMessageId ?? null,
			ingestedAt: r.ingestedAt,
		}));
	}

	private mapTimingExtensions(rows: MessMealTimingExtensionRow[]): MessMealTimingExtension[] {
		return rows.map((r) => ({
			id: r.id,
			mealDate: r.mealDate,
			mealSlot: r.mealSlot as MealSlot,
			targetVendor: (r.targetVendor as Vendor) ?? null,
			extendedTimings: r.extendedTimings,
			sourceMessageId: r.sourceMessageId ?? null,
			ingestedAt: r.ingestedAt,
		}));
	}

	private mapMealChanges(rows: MessMealChangeRow[]): MessMealChange[] {
		return rows.map((r) => ({
			id: r.id,
			mealDate: r.mealDate,
			mealSlot: r.mealSlot as MealSlot,
			targetVendor: r.targetVendor as Vendor,
			changeType: r.changeType as MealChangeType,
			affectedItem: r.affectedItem,
			originalItem: r.originalItem ?? null,
			sourceMessageId: r.sourceMessageId ?? null,
			ingestedAt: r.ingestedAt,
		}));
	}

	private mapLocationDetail(
		rows: MessMealLocationDetailRow[],
		mealSlot?: MealSlot | null,
	): MessMealLocationDetail | null {
		if (rows.length === 0) return null;
		const selected = rows.find((r) => r.mealSlot === (mealSlot ?? "lunch")) ?? rows[0];
		if (!selected) return null;
		return {
			id: selected.id,
			mealDate: selected.mealDate,
			mealSlot: selected.mealSlot as MealSlot,
			hostelBatches: Object.freeze([...selected.hostelBatches]),
			collegeBatches: Object.freeze([...selected.collegeBatches]),
			sourceMessageId: selected.sourceMessageId ?? null,
			ingestedAt: selected.ingestedAt,
		};
	}
}
