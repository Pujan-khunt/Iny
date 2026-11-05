import type * as Food from "../entities/FoodIngestion";

/** Classifies arbitrary thrown errors or abort signals into domain FoodFailure representations. */
export function classifyProcessingFailure(error: unknown, signal: AbortSignal): Food.FoodFailure {
	const f = (error as { failure?: Partial<Food.FoodFailure> } | null)?.failure;
	if (
		f &&
		typeof f.code === "string" &&
		typeof f.detail === "string" &&
		typeof f.retriable === "boolean"
	)
		return f as Food.FoodFailure;
	if (signal.aborted && error === signal.reason)
		return { code: "cancelled", detail: "Processing cancelled.", retriable: false };
	return {
		code: "unexpected_failure",
		detail: error instanceof Error ? error.message : "Unknown food processing failure.",
		retriable: false,
	};
}
