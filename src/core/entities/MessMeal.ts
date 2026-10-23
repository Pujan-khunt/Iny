/**
 * Pure domain entities and time helpers for the mess subsystem.
 * Strictly adheres to Hexagonal purity invariant with zero external runtime dependencies.
 */

export type MealSlot = "breakfast" | "lunch" | "dinner";
export type Vendor = "cheftalk_regular" | "cheftalk_jain" | "tcb";
export type MealChangeType = "replacement" | "addition" | "cancellation";

/** Base planned meal entity */
export interface MessMeal {
	readonly id: string;
	readonly mealDate: string; // 'YYYY-MM-DD'
	readonly mealSlot: MealSlot;
	readonly vendor: Vendor;
	readonly items: readonly string[];
	readonly sourceMessageId?: string | null;
	readonly ingestedAt: Date;
}

/** Lunch seating allocation */
export interface MessMealLocationDetail {
	readonly id: string;
	readonly mealDate: string;
	readonly mealSlot: MealSlot;
	readonly hostelBatches: readonly string[];
	readonly collegeBatches: readonly string[];
	readonly sourceMessageId?: string | null;
	readonly ingestedAt: Date;
}

/** Timing extension */
export interface MessMealTimingExtension {
	readonly id: string;
	readonly mealDate: string;
	readonly mealSlot: MealSlot;
	readonly targetVendor: Vendor | null;
	readonly extendedTimings: string;
	readonly sourceMessageId?: string | null;
	readonly ingestedAt: Date;
}

/** Live dish substitution/addition/cancellation */
export interface MessMealChange {
	readonly id: string;
	readonly mealDate: string;
	readonly mealSlot: MealSlot;
	readonly targetVendor: Vendor;
	readonly changeType: MealChangeType;
	readonly affectedItem: string;
	readonly originalItem: string | null;
	readonly sourceMessageId?: string | null;
	readonly ingestedAt: Date;
}

/** Composite aggregate returned by MessRepositoryPort */
export interface ResolvedMealInfo {
	readonly mealDate: string;
	readonly mealSlot: MealSlot | null; // Null if full-day multi-slot query
	readonly meals: readonly MessMeal[];
	readonly locationDetail: MessMealLocationDetail | null;
	readonly timingExtensions: readonly MessMealTimingExtension[];
	readonly mealChanges: readonly MessMealChange[];
}

export class MessMealFactory {
	private constructor() {}

	static create(params: {
		id?: string;
		mealDate: string;
		mealSlot: MealSlot;
		vendor: Vendor;
		items: readonly string[];
		sourceMessageId?: string | null;
		ingestedAt?: Date;
	}): MessMeal {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(params.mealDate)) {
			throw new Error(`Invalid mealDate format: ${params.mealDate}. Expected YYYY-MM-DD.`);
		}
		return {
			id: params.id ?? crypto.randomUUID(),
			mealDate: params.mealDate,
			mealSlot: params.mealSlot,
			vendor: params.vendor,
			items: Object.freeze([...params.items]),
			sourceMessageId: params.sourceMessageId ?? null,
			ingestedAt: params.ingestedAt ?? new Date(),
		};
	}
}

/**
 * Fixed IST (India Standard Time, UTC+05:30) offset in milliseconds.
 * India does not observe Daylight Saving Time (DST).
 */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export function getISTDateParts(date: Date): {
	year: number;
	month: number;
	day: number;
	hours: number;
	minutes: number;
} {
	const istDate = new Date(date.getTime() + IST_OFFSET_MS);
	return {
		year: istDate.getUTCFullYear(),
		month: istDate.getUTCMonth() + 1,
		day: istDate.getUTCDate(),
		hours: istDate.getUTCHours(),
		minutes: istDate.getUTCMinutes(),
	};
}

export function getISTDateString(date: Date): string {
	const { year, month, day } = getISTDateParts(date);
	const mm = String(month).padStart(2, "0");
	const dd = String(day).padStart(2, "0");
	return `${year}-${mm}-${dd}`;
}

export function getISTMinutes(date: Date): number {
	const { hours, minutes } = getISTDateParts(date);
	return hours * 60 + minutes;
}

/**
 * Evaluates whether a requested meal slot has already concluded relative to now (IST).
 * Cutoffs: Breakfast 09:30 AM (570m), Lunch 02:30 PM (870m), Dinner 09:30 PM (1290m).
 */
export function isMealEnded(mealDate: string, mealSlot: MealSlot, now: Date): boolean {
	const istDate = getISTDateString(now);
	if (mealDate < istDate) return true;
	if (mealDate > istDate) return false;

	const currentMinutes = getISTMinutes(now);
	switch (mealSlot) {
		case "breakfast":
			return currentMinutes > 570; // Past 09:30 AM
		case "lunch":
			return currentMinutes > 870; // Past 02:30 PM
		case "dinner":
			return currentMinutes > 1290; // Past 09:30 PM
	}
}

/**
 * Resolves the active upcoming meal slot deterministically against standard closing hours.
 * Post 21:30 IST rolls over to tomorrow's breakfast.
 */
export function determineNextUpcomingSlot(now: Date): {
	mealDate: string;
	mealSlot: MealSlot;
} {
	const currentMinutes = getISTMinutes(now);
	const todayIST = getISTDateString(now);

	if (currentMinutes <= 570) {
		return { mealDate: todayIST, mealSlot: "breakfast" };
	} else if (currentMinutes <= 870) {
		return { mealDate: todayIST, mealSlot: "lunch" };
	} else if (currentMinutes <= 1290) {
		return { mealDate: todayIST, mealSlot: "dinner" };
	} else {
		// Post 21:30 IST rolls over to tomorrow breakfast
		const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
		return { mealDate: getISTDateString(tomorrow), mealSlot: "breakfast" };
	}
}
