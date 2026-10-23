import OpenAI from "openai";
import { z } from "zod";
import { LLMError, LLMResponseError } from "../../../../core/errors/LLMErrors";
import { translateAndThrowDeepseekError } from "../../llm/DeepseekErrorTranslator";

export function cleanJsonResponse(raw: string): string {
	const trimmed = raw.trim();
	const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	if (match) {
		return match[1].trim();
	}
	return trimmed;
}

export function classifyAndThrowExtractorError(error: any, rawResponse?: string): never {
	if (error instanceof LLMError) {
		if (rawResponse && !error.rawResponse) {
			(error as any).rawResponse = rawResponse;
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

export function resolveOpenAiClient(
	clientOrApiKeyOrOptions:
		OpenAI | string | { client?: OpenAI; apiKey?: string; baseURL?: string; model?: string },
	options?: { baseURL?: string; model?: string },
): { client: OpenAI; model: string } {
	if (typeof clientOrApiKeyOrOptions === "string") {
		return {
			client: new OpenAI({
				apiKey: clientOrApiKeyOrOptions,
				baseURL: options?.baseURL ?? "https://api.deepseek.com",
			}),
			model: options?.model ?? "deepseek-flash",
		};
	}

	if (
		typeof clientOrApiKeyOrOptions === "object" &&
		clientOrApiKeyOrOptions !== null &&
		"chat" in clientOrApiKeyOrOptions
	) {
		return {
			client: clientOrApiKeyOrOptions as OpenAI,
			model: options?.model ?? "deepseek-flash",
		};
	}

	if (typeof clientOrApiKeyOrOptions === "object" && clientOrApiKeyOrOptions !== null) {
		const opts = clientOrApiKeyOrOptions;
		if (opts.client) {
			return {
				client: opts.client,
				model: opts.model ?? options?.model ?? "deepseek-flash",
			};
		}
		if (opts.apiKey) {
			return {
				client: new OpenAI({
					apiKey: opts.apiKey,
					baseURL: opts.baseURL ?? options?.baseURL ?? "https://api.deepseek.com",
				}),
				model: opts.model ?? options?.model ?? "deepseek-flash",
			};
		}
	}

	throw new Error("Either an OpenAI client instance or apiKey is required");
}
