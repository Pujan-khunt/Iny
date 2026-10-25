import {
	LLMError,
	LLMAuthenticationError,
	LLMInsufficientBalanceError,
	LLMInvalidRequestError,
	LLMRateLimitError,
	LLMServerError,
	LLMServerOverloadedError,
} from "../../../core/errors/LLMErrors";

function buildErrorForStatus(
	status: number | undefined,
	message: string,
	opts: { status?: number; code?: string; cause?: unknown; rawResponse?: string },
): LLMError {
	switch (status) {
		case 400:
		case 422:
			return new LLMInvalidRequestError(message, opts);
		case 401:
			return new LLMAuthenticationError(message, opts);
		case 402:
			return new LLMInsufficientBalanceError(message, opts);
		case 429:
			return new LLMRateLimitError(message, opts);
		case 500:
			return new LLMServerError(message, opts);
		case 503:
			return new LLMServerOverloadedError(message, opts);
		default:
			return new LLMError(message, opts);
	}
}

interface ErrorWithHttpMetadata {
	status?: number;
	code?: string;
	message?: string;
}

/**
 * Translates low-level provider or network errors into domain-specific LLM error subclasses.
 * Always throws and never returns.
 *
 * @param error The raw error encountered during API communication.
 * @throws LLMError or a specific subclass corresponding to the HTTP status.
 */
export function translateAndThrowDeepseekError(error: unknown, rawResponse?: string): never {
	if (error instanceof LLMError) {
		if (rawResponse && !error.rawResponse) {
			(error as LLMError & { rawResponse?: string }).rawResponse = rawResponse;
		}
		throw error;
	}

	const errObj =
		typeof error === "object" && error !== null ? (error as ErrorWithHttpMetadata) : undefined;
	const status = errObj?.status;
	const code = errObj?.code;
	const message = errObj?.message || "Error occurred while communicating with LLM provider";
	const opts = { status, code, cause: error, rawResponse };

	throw buildErrorForStatus(status, message, opts);
}
