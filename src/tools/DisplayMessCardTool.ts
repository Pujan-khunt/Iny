import { z } from "zod";
import { BaseTool } from "./BaseTool.js";
import { ToolResult } from "../core/ports/ToolRegistryPort.js";
import { MessRepositoryPort } from "../core/ports/MessRepositoryPort.js";
import {
	MealSlot,
	determineNextUpcomingSlot,
	getISTDateString,
	isMealEnded,
} from "../core/entities/MessMeal.js";
import {
	renderMultiVendorSlotDigest,
	renderSingleVendorSlotDetail,
	renderSingleVendorFullDayDigest,
} from "../adapters/outbound/mess/formatting/MessCardRenderer.js";

export const displayMessCardSchema = z.object({
	mealDate: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO YYYY-MM-DD")
		.optional()
		.describe(
			"ISO calendar date in YYYY-MM-DD format. Omit this field if the user is referring to the current or upcoming meal, or when the user does not specify an explicit date.",
		),
	mealSlot: z
		.enum(["breakfast", "lunch", "dinner"])
		.optional()
		.describe(
			'Strictly provide ONLY if the user explicitly mentions "breakfast", "lunch", or "dinner". If the user did NOT mention a specific meal name (e.g. they asked "menu", "food", "what is there to eat?"), you MUST omit this field so the deterministic system resolves the active or upcoming meal cutoff.',
		),
	vendor: z
		.enum(["cheftalk_regular", "cheftalk_jain", "tcb"])
		.optional()
		.describe(
			"Optional mess caterer. Rules: " +
				'(1) If the user specifically mentions "jain" or "cheftalk jain", pass "cheftalk_jain". ' +
				'(2) If the user mentions "cheftalk" without specifying Jain, pass "cheftalk_regular". ' +
				'(3) If the user mentions "tcb" or "uniworld", pass "tcb". ' +
				'(4) If the user does not specify any caterer (e.g. "what\'s for lunch?"), OMIT this field to display all caterers.',
		),
});

/**
 * Terminal presentation tool serving 95% of standard meal and location lookups.
 * Routes dynamically across 4 presentation quadrants:
 * - Q1: Multi-Vendor Slot Digest (Slot provided, Vendor omitted)
 * - Q2: Single-Vendor Slot Detail (Slot provided, Vendor provided)
 * - Q3: Rollover Multi-Vendor Digest (Slot omitted, Vendor omitted)
 * - Q4: Single-Vendor Full-Day Digest (Slot omitted, Vendor provided)
 */
export class DisplayMessCardTool extends BaseTool<typeof displayMessCardSchema> {
	readonly name = "display_mess_card";
	readonly description = "Serves 95% of standard meal and location lookups.";
	readonly schema = displayMessCardSchema as typeof displayMessCardSchema & Record<string, unknown>;

	constructor(
		private readonly messRepository: MessRepositoryPort,
		private readonly getCurrentTime: () => Date = () => new Date(),
	) {
		super();
	}

	protected async run(args: z.infer<typeof displayMessCardSchema>): Promise<ToolResult> {
		const now = this.getCurrentTime();
		const { mealDate, mealSlot, vendor } = args;

		// Quadrant 4: Single-Vendor Full-Day Digest (Slot Omitted, Vendor Provided)
		if (!mealSlot && vendor) {
			const targetDate = mealDate ?? getISTDateString(now);
			const resolved = await this.messRepository.getResolvedMeal({
				mealDate: targetDate,
				vendor,
				mealSlot: undefined,
			});

			if (resolved.meals.length === 0) {
				return {
					content: "No menu scheduled for the requested meal.",
					isTerminal: false,
				};
			}

			const rendered = renderSingleVendorFullDayDigest(resolved, vendor, now);
			return {
				content: rendered,
				isTerminal: true,
			};
		}

		// Quadrants 1, 2, 3: Single Slot Queries
		let targetDate: string;
		let targetSlot: MealSlot;

		if (!mealSlot) {
			// Quadrant 3: Next upcoming meal rollover
			const upcoming = determineNextUpcomingSlot(now);
			targetDate = mealDate ?? upcoming.mealDate;
			targetSlot = upcoming.mealSlot;
		} else {
			// Quadrants 1 & 2: Slot explicitly specified
			targetDate = mealDate ?? getISTDateString(now);
			targetSlot = mealSlot;
		}

		const resolved = await this.messRepository.getResolvedMeal({
			mealDate: targetDate,
			mealSlot: targetSlot,
			vendor,
		});

		if (resolved.meals.length === 0) {
			return {
				content: "No menu scheduled for the requested meal.",
				isTerminal: false,
			};
		}

		if (vendor && !resolved.meals.some((m) => m.vendor === vendor)) {
			return {
				content: "No menu scheduled for the requested meal.",
				isTerminal: false,
			};
		}

		const ended = isMealEnded(targetDate, targetSlot, now);

		let rendered: string;
		if (vendor) {
			// Quadrant 2: Single-Vendor Slot Detail
			rendered = renderSingleVendorSlotDetail(resolved, vendor, ended);
		} else {
			// Quadrant 1 & 3: Multi-Vendor Slot Digest
			rendered = renderMultiVendorSlotDigest(resolved, ended);
		}

		return {
			content: rendered,
			isTerminal: true,
		};
	}
}
