import { z } from "zod";
const text = z.string().min(1);
const date = text.regex(/^\d{4}-\d{2}-\d{2}$/);
const vendor = z.enum(["cheftalk_regular", "cheftalk_jain", "tcb"]);
const slot = z.enum(["breakfast", "lunch", "dinner"]);
const dated = { mealDate: date, mealSlot: slot };
const weekly = z.strictObject({
	kind: z.literal("weekly_menu"),
	dateRange: z.strictObject({ start: date, end: date }),
	menu: z.strictObject({
		vendor,
		meals: z.array(z.strictObject({ ...dated, items: z.array(text).min(1) })),
	}),
});
const operational = z.strictObject({
	kind: z.literal("operational_announcement"),
	announcement: z.strictObject({
		locations: z.array(
			z.strictObject({ ...dated, hostelBatches: z.array(text), collegeBatches: z.array(text) }),
		),
		timings: z.array(
			z.strictObject({ ...dated, targetVendor: vendor.nullable(), extendedTimings: text }),
		),
		changes: z.array(
			z.strictObject({
				...dated,
				targetVendor: vendor,
				changeType: z.enum(["replacement", "addition", "cancellation"]),
				affectedItem: text,
				originalItem: text.nullable(),
			}),
		),
		swaps: z.array(
			z.strictObject({
				sourceMealDate: date,
				sourceMealSlot: slot,
				targetMealDate: date,
				targetMealSlot: slot,
				targetVendor: vendor.nullable(),
			}),
		),
	}),
});
const evidence = z.strictObject({
	fieldPath: text.regex(/^\/(?:menu|dateRange|announcement)\//),
	rawValue: text,
	clause: text,
	location: z.discriminatedUnion("kind", [
		z
			.strictObject({
				kind: z.literal("text"),
				start: z.number().int().nonnegative(),
				end: z.number().int().positive(),
			})
			.refine((v) => v.end > v.start),
		z.strictObject({ kind: z.literal("image"), page: z.literal(1), row: text, column: text }),
	]),
});
/** Strict first-pass envelopes; abstention and candidate fields are never repaired. */
export const FoodExtractionSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("candidate"),
		candidate: z.discriminatedUnion("kind", [weekly, operational]),
		evidence: z.array(evidence),
	}),
	z.strictObject({ kind: z.literal("unsupported"), detail: text }),
	z.strictObject({ kind: z.literal("uncertain"), detail: text }),
]);
/** Independent verifier can report agreement, rejection or uncertainty, never replacements. */
export const FoodVerificationSchema = z.strictObject({
	verdict: z.enum(["accept", "reject", "uncertain"]),
	completeCoverage: z.boolean(),
	missingFields: z.array(text),
	conflictingFields: z.array(text),
	unsupportedClauses: z.array(text),
});
/** SDK completion envelope must be complete and contain one unrepaired text response. */
export const FoodCompletionSchema = z.object({
	choices: z.tuple([
		z.object({
			finish_reason: z.literal("stop"),
			message: z.object({
				role: z.literal("assistant"),
				content: text.refine((v) => !!v.trim()),
				refusal: z.null().optional(),
				tool_calls: z.array(z.never()).optional(),
			}),
		}),
	]),
});

/** Diagnostic audit record tracking raw LLM inference and candidate types. */
export type AssessmentAudit = Record<
	"rawExtraction" | "rawVerification" | "model" | "promptVersion",
	string
> & {
	recognizedType?: "weekly_menu" | "operational_announcement";
};
