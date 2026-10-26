import { z } from "zod";
import { BaseTool } from "./BaseTool";
import { ToolResult } from "../core/ports/ToolRegistryPort";
import { MessRepositoryPort } from "../core/ports/MessRepositoryPort";
import { getISTDateString } from "../core/entities/MessMeal";

const queryMessDetailsSchema = z.object({
	mealDate: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO YYYY-MM-DD")
		.optional()
		.describe(
			"ISO calendar date in YYYY-MM-DD format. Omit to query current or upcoming meal date.",
		),
	mealSlot: z
		.enum(["breakfast", "lunch", "dinner"])
		.optional()
		.describe(
			'Meal slot: "breakfast", "lunch", or "dinner". Omit to query all slots for the date.',
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

	constructor(
		private readonly messRepository: MessRepositoryPort,
		private readonly getCurrentTime: () => Date = () => new Date(),
	) {
		super();
	}

	protected async run(args: QueryMessDetailsInput): Promise<ToolResult> {
		const now = this.getCurrentTime();
		const targetDate = args.mealDate ?? getISTDateString(now);

		const resolved = await this.messRepository.getResolvedMeal({
			mealDate: targetDate,
			mealSlot: args.mealSlot,
			vendor: args.vendor,
		});

		return {
			content: JSON.stringify(resolved),
			isTerminal: false,
		};
	}
}
