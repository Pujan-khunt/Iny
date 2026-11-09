import { z } from "zod";
import { BaseTool } from "./BaseTool";
import { ToolExecutionContext, ToolResult } from "../core/ports/ToolRegistryPort";
import { MessRepositoryPort } from "../core/ports/MessRepositoryPort";
import { MessCardPresenterPort } from "../core/ports/MessCardPresenterPort";
import { AccessControlPort } from "../core/ports/AccessControlPort";
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
		.describe("Provide ONLY when the user explicitly specifies a calendar date (YYYY-MM-DD)."),
	mealSlot: z
		.enum(["breakfast", "lunch", "dinner", "all", "upcoming"])
		.default("upcoming")
		.describe(
			'Meal slot: "breakfast", "lunch", or "dinner" for specific meals; "all" when the user asks for a full day menu / all slots; "upcoming" (default) for current/upcoming active meal rollover.',
		),
	vendor: z
		.enum(["cheftalk_regular", "cheftalk_jain", "tcb"])
		.optional()
		.describe('Caterer: "cheftalk_regular", "cheftalk_jain", "tcb" (The Craving Brew / Uniworld).'),
});

type DisplayMessCardInput = z.infer<typeof displayMessCardSchema>;

/**
 * Terminal presentation tool serving mess meals with automatic cutoff and upcoming meal rollover.
 */
export class DisplayMessCardTool extends BaseTool<typeof displayMessCardSchema> {
	readonly name = "display_mess_card";
	readonly description =
		'Renders formatted WhatsApp mess meal cards: (1) Slot query or all vendors (e.g. "what\'s for lunch", "all vendor lunch") -> pass mealSlot and omit vendor to render all caterers in one card; (2) Single-vendor slot (e.g. "cheftalk lunch") -> pass mealSlot and vendor; (3) Generic menu or single-vendor menu (e.g. "menu", "food", "cheftalk menu") -> pass mealSlot: "upcoming" (default) for automatic cutoff and upcoming meal rollover; (4) Full day menu (e.g. "cheftalk full day menu", "all slots for cheftalk") -> pass mealSlot: "all" and vendor. Output is terminal. Call at most once per turn; never call speculatively in parallel.';
	readonly schema = displayMessCardSchema as typeof displayMessCardSchema & Record<string, unknown>;

	private readonly accessControl?: AccessControlPort;
	private readonly getCurrentTime: () => Date;

	constructor(
		private readonly messRepository: MessRepositoryPort,
		private readonly presenter: MessCardPresenterPort,
		accessControlOrTime?: AccessControlPort | (() => Date),
		getCurrentTime?: () => Date,
	) {
		super();
		const isFn = typeof accessControlOrTime === "function";
		this.accessControl = isFn ? undefined : accessControlOrTime;
		this.getCurrentTime = isFn ? accessControlOrTime : (getCurrentTime ?? (() => new Date()));
	}

	protected async run(
		args: DisplayMessCardInput,
		context?: ToolExecutionContext,
	): Promise<ToolResult> {
		const now = this.getCurrentTime();
		if (args.mealSlot === "all") {
			const vendor = args.vendor ?? (await this.resolveUserDefaultVendor(context?.userId));
			return this.handleFullDay(args.mealDate, vendor, now);
		}
		return this.handleSlotQuery(args, now, context);
	}

	private async handleFullDay(
		date: string | undefined,
		vendor: Vendor,
		now: Date,
	): Promise<ToolResult> {
		const targetDate = date ?? getISTDateString(now);
		const res = await this.messRepository.getResolvedMeal({ mealDate: targetDate, vendor });
		if (res.meals.length === 0 || !res.meals.some((m) => m.vendor === vendor)) {
			return {
				content: this.presenter.renderEmptyNotice(targetDate, vendor, undefined, now),
				isTerminal: true,
			};
		}
		const content = this.presenter.renderSingleVendorFullDayDigest(res, vendor, now);
		return { content, isTerminal: true };
	}

	private async handleSlotQuery(
		args: DisplayMessCardInput,
		now: Date,
		context?: ToolExecutionContext,
	): Promise<ToolResult> {
		const userDefault = this.accessControl
			? await this.resolveUserDefaultVendor(context?.userId)
			: undefined;
		const isUpcoming = args.mealSlot === "upcoming";
		const vendor = args.vendor ?? (isUpcoming ? userDefault : undefined);
		const { targetDate, targetSlot } = this.resolveSlotTarget(args, now);
		const res = await this.messRepository.getResolvedMeal({
			mealDate: targetDate,
			mealSlot: targetSlot,
			vendor,
		});

		if (res.meals.length === 0 || (vendor && !res.meals.some((m) => m.vendor === vendor))) {
			return {
				content: this.presenter.renderEmptyNotice(targetDate, vendor, targetSlot, now),
				isTerminal: true,
			};
		}

		const ended = isMealEnded(targetDate, targetSlot, now);
		const content = vendor
			? this.presenter.renderSingleVendorSlotDetail(res, vendor, ended, userDefault, now)
			: this.presenter.renderMultiVendorSlotDigest(res, ended, now);

		return { content, isTerminal: true };
	}

	private async resolveUserDefaultVendor(userId?: string): Promise<Vendor> {
		if (userId && this.accessControl) {
			const user = await this.accessControl.getUser(userId);
			if (user?.defaultVendor) return user.defaultVendor;
		}
		return "cheftalk_regular";
	}

	private resolveSlotTarget(
		args: DisplayMessCardInput,
		now: Date,
	): { targetDate: string; targetSlot: MealSlot } {
		if (args.mealSlot !== "upcoming") {
			return {
				targetDate: args.mealDate ?? getISTDateString(now),
				targetSlot: args.mealSlot as MealSlot,
			};
		}
		const upcoming = determineNextUpcomingSlot(now);
		const targetDate = args.mealDate ?? upcoming.mealDate;
		const targetSlot =
			!args.mealDate || args.mealDate === upcoming.mealDate ? upcoming.mealSlot : "breakfast";
		return { targetDate, targetSlot };
	}
}
