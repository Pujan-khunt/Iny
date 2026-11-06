import { z } from "zod";
import { BaseTool } from "./BaseTool";
import { ToolExecutionContext, ToolResult } from "../core/ports/ToolRegistryPort";
import { MessRepositoryPort } from "../core/ports/MessRepositoryPort";
import { AccessControlPort } from "../core/ports/AccessControlPort";
import {
	MealSlot,
	Vendor,
	determineNextUpcomingSlot,
	getISTDateString,
} from "../core/entities/MessMeal";

const queryMessDetailsSchema = z.object({
	mealDate: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO YYYY-MM-DD")
		.optional()
		.describe(
			"ISO calendar date in YYYY-MM-DD format. Omit to query current or upcoming meal date.",
		),
	mealSlot: z
		.enum(["breakfast", "lunch", "dinner", "all", "upcoming"])
		.default("all")
		.describe(
			'Meal slot: "breakfast", "lunch", or "dinner" for specific meals; "all" (default) to inspect dishes across all slots of the day; "upcoming" for the current/upcoming active meal.',
		),
	vendor: z
		.enum(["cheftalk_regular", "cheftalk_jain", "tcb"])
		.optional()
		.describe(
			'Optional vendor caterer: "cheftalk_regular", "cheftalk_jain", or "tcb". Omit to query across all vendors.',
		),
});

type QueryMessDetailsInput = z.infer<typeof queryMessDetailsSchema>;

/**
 * Conversational tool serving analytical or specific dietary questions.
 * Returns raw structured JSON of ResolvedMealInfo with isTerminal: false.
 */
export class QueryMessDetailsTool extends BaseTool<typeof queryMessDetailsSchema> {
	readonly name = "query_mess_details";
	readonly description =
		'Queries raw structured mess meal data (dishes, seating locations, extensions, live substitutions) strictly for specific dietary, ingredient, or comparative questions (e.g. "is there paneer in lunch?", "who is serving chicken today?"). Do NOT use this tool for showing general menus or meal cards (use display_mess_card instead).';
	readonly schema = queryMessDetailsSchema as typeof queryMessDetailsSchema &
		Record<string, unknown>;

	private readonly accessControl?: AccessControlPort;
	private readonly getCurrentTime: () => Date;

	constructor(
		private readonly messRepository: MessRepositoryPort,
		accessControlOrTime?: AccessControlPort | (() => Date),
		getCurrentTime?: () => Date,
	) {
		super();
		const isFn = typeof accessControlOrTime === "function";
		this.accessControl = isFn ? undefined : accessControlOrTime;
		this.getCurrentTime = isFn ? accessControlOrTime : (getCurrentTime ?? (() => new Date()));
	}

	protected async run(
		args: QueryMessDetailsInput,
		context?: ToolExecutionContext,
	): Promise<ToolResult> {
		const now = this.getCurrentTime();
		const { targetDate, targetSlot } = this.resolveTarget(args, now);
		const userDefaultVendor = await this.resolveUserDefaultVendor(context?.userId);

		const resolved = await this.messRepository.getResolvedMeal({
			mealDate: targetDate,
			mealSlot: targetSlot,
			vendor: args.vendor,
		});

		const payload = userDefaultVendor ? { userDefaultVendor, ...resolved } : resolved;

		return {
			content: JSON.stringify(payload),
			isTerminal: false,
		};
	}

	private async resolveUserDefaultVendor(userId?: string): Promise<Vendor | undefined> {
		if (userId && this.accessControl) {
			const user = await this.accessControl.getUser(userId);
			return user?.defaultVendor ?? "cheftalk_regular";
		}
		return undefined;
	}

	private resolveTarget(
		args: QueryMessDetailsInput,
		now: Date,
	): { targetDate: string; targetSlot?: MealSlot } {
		if (args.mealSlot === "upcoming") {
			const upcoming = determineNextUpcomingSlot(now);
			const targetDate = args.mealDate ?? upcoming.mealDate;
			const targetSlot =
				!args.mealDate || args.mealDate === upcoming.mealDate ? upcoming.mealSlot : "breakfast";
			return { targetDate, targetSlot };
		}
		if (args.mealSlot === "all") {
			return {
				targetDate: args.mealDate ?? getISTDateString(now),
				targetSlot: undefined,
			};
		}
		return {
			targetDate: args.mealDate ?? getISTDateString(now),
			targetSlot: args.mealSlot,
		};
	}
}
