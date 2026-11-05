import { z } from "zod";
import { LLMError, LLMResponseError } from "../../../../core/errors/LLMErrors";
import { translateAndThrowDeepseekError } from "../../llm/DeepseekErrorTranslator";

/**
 * Removes an optional JSON markdown fence.
 * @param raw Original provider response text.
 * @returns Trimmed JSON content, retaining the payload text unchanged.
 */
export function cleanJsonResponse(raw: string): string {
	const trimmed = raw.trim();
	const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	if (match) {
		return match[1].trim();
	}
	return trimmed;
}

/**
 * Translates schema, JSON, and provider failures while preserving diagnostic evidence.
 * @param error Original extraction failure.
 * @param rawResponse Unmodified response content, when available.
 * @throws LLMError or a specific subclass; never returns.
 */
export function classifyAndThrowExtractorError(error: unknown, rawResponse?: string): never {
	if (error instanceof LLMError) {
		if (rawResponse && !error.rawResponse) {
			(error as LLMError & { rawResponse?: string }).rawResponse = rawResponse;
		}
		throw error;
	}
	if (error instanceof z.ZodError) {
		throw new LLMResponseError(`LLM response failed schema validation: ${error.message}`, {
			cause: error,
			rawResponse,
		});
	}
	if (error instanceof SyntaxError) {
		throw new LLMResponseError(`Failed to parse LLM JSON response: ${error.message}`, {
			cause: error,
			rawResponse,
		});
	}
	translateAndThrowDeepseekError(error, rawResponse);
}
