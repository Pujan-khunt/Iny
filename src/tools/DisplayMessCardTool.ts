import { z } from "zod";
import { BaseTool } from "./BaseTool";
import { ToolResult } from "../core/ports/ToolRegistryPort";
import { MessRepositoryPort } from "../core/ports/MessRepositoryPort";
import { MessCardPresenterPort } from "../core/ports/MessCardPresenterPort";
import {
	MealSlot,
	Vendor,
	determineNextUpcomingSlot,
	getISTDateString,
	isMealEnded,
} from "../core/entities/MessMeal";

const displayMessCardSchema = z.object({
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

type DisplayMessCardInput = z.infer<typeof displayMessCardSchema>;

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
		private readonly presenter: MessCardPresenterPort,
		private readonly getCurrentTime: () => Date = () => new Date(),
	) {
		super();
	}

	protected async run(args: DisplayMessCardInput): Promise<ToolResult> {
		const now = this.getCurrentTime();
		if (!args.mealSlot && args.vendor) {
			return this.handleFullDayDigest(args.mealDate, args.vendor, now);
		}
		return this.handleSlotQuery(args, now);
	}

	private async handleFullDayDigest(
		mealDate: string | undefined,
		vendor: Vendor,
		now: Date,
	): Promise<ToolResult> {
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

		return {
			content: this.presenter.renderSingleVendorFullDayDigest(resolved, vendor, now),
			isTerminal: true,
		};
	}

	private async handleSlotQuery(args: DisplayMessCardInput, now: Date): Promise<ToolResult> {
		const { targetDate, targetSlot } = this.resolveSlotTarget(args, now);
		const resolved = await this.messRepository.getResolvedMeal({
			mealDate: targetDate,
			mealSlot: targetSlot,
			vendor: args.vendor,
		});

		if (
			resolved.meals.length === 0 ||
			(args.vendor && !resolved.meals.some((m) => m.vendor === args.vendor))
		) {
			return {
				content: "No menu scheduled for the requested meal.",
				isTerminal: false,
			};
		}

		const ended = isMealEnded(targetDate, targetSlot, now);
		const content = args.vendor
			? this.presenter.renderSingleVendorSlotDetail(resolved, args.vendor, ended)
			: this.presenter.renderMultiVendorSlotDigest(resolved, ended);

		return {
			content,
			isTerminal: true,
		};
	}

	private resolveSlotTarget(
		args: DisplayMessCardInput,
		now: Date,
	): { targetDate: string; targetSlot: MealSlot } {
		if (!args.mealSlot) {
			const upcoming = determineNextUpcomingSlot(now);
			return {
				targetDate: args.mealDate ?? upcoming.mealDate,
				targetSlot: upcoming.mealSlot,
			};
		}
		return {
			targetDate: args.mealDate ?? getISTDateString(now),
			targetSlot: args.mealSlot,
		};
	}
}
