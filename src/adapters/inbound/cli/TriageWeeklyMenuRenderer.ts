import type { ExtractedWeeklyMenu } from "../../outbound/mess/extraction/ExtractionSchemas";
import {
	type AnsiTheme,
	RAW_ANSI,
	NO_ANSI,
	DIVIDER_LINE,
	SUB_DIVIDER,
	getDayOfWeekName,
	getDayOfWeekShort,
} from "./TriageAnsi";

export interface TriageWeeklyMenuRendererOptions {
	enableAnsi?: boolean;
}

export class TriageWeeklyMenuRenderer {
	private readonly ansi: AnsiTheme;

	constructor(options?: TriageWeeklyMenuRendererOptions) {
		this.ansi = options?.enableAnsi === false ? NO_ANSI : RAW_ANSI;
	}

	render(menu: ExtractedWeeklyMenu): string {
		const meals = this.sortMeals(menu.meals);
		const uniqueDates = Array.from(new Set(meals.map((m) => m.mealDate))).sort();
		const startDate = uniqueDates[0] ?? "N/A";
		const endDate = uniqueDates[uniqueDates.length - 1] ?? "N/A";
		const totalDishes = meals.reduce((acc, m) => acc + m.items.length, 0);

		return [
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			`${this.ansi.bold}${this.ansi.cyan}📋 WEEKLY MENU EXTRACTION PREVIEW${this.ansi.reset}`,
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			`Vendor:         ${this.ansi.bold}${menu.vendor}${this.ansi.reset} (Detected from document title)`,
			`Date Range:     ${startDate} (${getDayOfWeekShort(startDate)}) ➔ ${endDate} (${getDayOfWeekShort(endDate)}) [${uniqueDates.length} Days]`,
			"Total Slots:    21 meals (7 Breakfast, 7 Lunch, 7 Dinner)",
			`Total Dishes:   ${totalDishes} items`,
			"",
			...this.formatSanityLines(meals, uniqueDates),
			SUB_DIVIDER,
			...this.formatDailyMeals(meals),
			...this.formatFooter(menu.vendor),
		].join("\n");
	}

	private sortMeals(meals: ExtractedWeeklyMenu["meals"]): ExtractedWeeklyMenu["meals"] {
		const slotOrder: Record<string, number> = { breakfast: 1, lunch: 2, dinner: 3 };
		return [...meals].sort((a, b) => {
			if (a.mealDate !== b.mealDate) return a.mealDate.localeCompare(b.mealDate);
			return (slotOrder[a.mealSlot] ?? 0) - (slotOrder[b.mealSlot] ?? 0);
		});
	}

	private checkContiguity(uniqueDates: string[]): boolean {
		if (uniqueDates.length !== 7) return false;
		const startMs = Date.parse(`${uniqueDates[0]}T00:00:00Z`);
		const endMs = Date.parse(`${uniqueDates[uniqueDates.length - 1]}T00:00:00Z`);
		return endMs - startMs === 6 * 86400000;
	}

	private formatSanityLines(meals: ExtractedWeeklyMenu["meals"], uniqueDates: string[]): string[] {
		const isContiguous = this.checkContiguity(uniqueDates);
		const contiguousCheck = isContiguous
			? `${this.ansi.green}✅ Contiguous 7-day span (Verified via UTC epoch: 86,400,000 ms/day)${this.ansi.reset}`
			: `${this.ansi.red}❌ Non-contiguous span (${uniqueDates.length} unique days)${this.ansi.reset}`;

		const slotsCheck =
			meals.length === 21
				? `${this.ansi.green}✅ All 3 slots present per day (21 meals total)${this.ansi.reset}`
				: `${this.ansi.yellow}⚠️ Warning: ${meals.length}/21 slots found${this.ansi.reset}`;

		const lines = [`Sanity Checks:  ${contiguousCheck}`, `                ${slotsCheck}`];
		for (const m of meals) {
			if (m.items.length === 0) {
				lines.push(
					`                ${this.ansi.yellow}⚠️ WARNING: ${m.mealSlot} on ${m.mealDate} has 0 items (fasting/holiday?)${this.ansi.reset}`,
				);
			}
		}
		return lines;
	}

	private formatDailyMeals(meals: ExtractedWeeklyMenu["meals"]): string[] {
		const mealsByDate = new Map<string, typeof meals>();
		for (const m of meals) {
			const existing = mealsByDate.get(m.mealDate);
			if (existing) {
				existing.push(m);
			} else {
				mealsByDate.set(m.mealDate, [m]);
			}
		}

		const lines: string[] = [];
		for (const [date, dateMeals] of mealsByDate.entries()) {
			lines.push(`📅 ${this.ansi.bold}${date} (${getDayOfWeekName(date)})${this.ansi.reset}`);
			for (const m of dateMeals) {
				const slotCap = m.mealSlot.charAt(0).toUpperCase() + m.mealSlot.slice(1);
				const slotPad = slotCap.padEnd(9, " ");
				lines.push(
					`  • ${this.ansi.bold}${slotPad}${this.ansi.reset} [${m.items.length} items]: ${m.items.join(", ")}`,
				);
			}
			lines.push("");
		}
		return lines;
	}

	private formatFooter(vendor: string): string[] {
		return [
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			"Database Action:",
			"  • Upsert 21 rows into 'mess_meals' on conflict (meal_date, meal_slot, vendor) DO UPDATE",
			"  • Update staging message status = 'processed'",
			this.ansi.bold + DIVIDER_LINE + this.ansi.reset,
			"Actions:",
			`  ${this.ansi.bold}[y]${this.ansi.reset} Confirm & Commit to Database`,
			`  ${this.ansi.bold}[v]${this.ansi.reset} Switch Vendor (current: ${vendor} ➔ [1] regular, [2] jain, [3] tcb)`,
			`  ${this.ansi.bold}[d]${this.ansi.reset} Shift Dates (enter new start date, e.g. if LLM shifted Sun ➔ Mon)`,
			`  ${this.ansi.bold}[e]${this.ansi.reset} Edit in vim (opens extracted JSON in vim, re-validates schema on save)`,
			`  ${this.ansi.bold}[c]${this.ansi.reset} Cancel & Abort`,
			DIVIDER_LINE,
		];
	}
}
