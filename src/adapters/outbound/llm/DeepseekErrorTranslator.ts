import {
	LLMError,
	LLMAuthenticationError,
	LLMInsufficientBalanceError,
	LLMInvalidRequestError,
	LLMRateLimitError,
	LLMServerError,
	LLMServerOverloadedError,
} from "../../../core/errors/LLMErrors";

/**
 * Translates low-level provider or network errors into domain-specific LLM error subclasses.
 * Always throws and never returns.
 *
 * @param error The raw error encountered during API communication.
 * @throws LLMError or a specific subclass corresponding to the HTTP status.
 */
export function translateAndThrowDeepseekError(error: any, rawResponse?: string): never {
	if (error instanceof LLMError) {
		if (rawResponse && !error.rawResponse) {
			(error as any).rawResponse = rawResponse;
		}
		throw error;
	}

	const status = error?.status;
	const code = error?.code;
	const message = error?.message || "Error occurred while communicating with LLM provider";
	const opts = { status, code, cause: error, rawResponse };

	switch (status) {
		case 400:
		case 422:
			throw new LLMInvalidRequestError(message, opts);
		case 401:
			throw new LLMAuthenticationError(message, opts);
		case 402:
			throw new LLMInsufficientBalanceError(message, opts);
		case 429:
			throw new LLMRateLimitError(message, opts);
		case 500:
			throw new LLMServerError(message, opts);
		case 503:
			throw new LLMServerOverloadedError(message, opts);
		default:
			throw new LLMError(message, opts);
	}
}
