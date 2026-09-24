import {
  LLMError,
  LLMAuthenticationError,
  LLMInsufficientBalanceError,
  LLMInvalidRequestError,
  LLMRateLimitError,
  LLMServerError,
  LLMServerOverloadedError,
} from '../../../core/errors/LLMErrors';

/**
 * Translates low-level provider or network errors into domain-specific LLM error subclasses.
 * Always throws and never returns.
 *
 * @param error The raw error encountered during API communication.
 * @throws LLMError or a specific subclass corresponding to the HTTP status.
 */
export function translateAndThrowDeepseekError(error: any): never {
  if (error instanceof LLMError) {
    throw error;
  }

  const status = error?.status;
  const code = error?.code;
  const message = error?.message || 'Error occurred while communicating with LLM provider';

  switch (status) {
    case 400:
    case 422:
      throw new LLMInvalidRequestError(message, { status, code, cause: error });
    case 401:
      throw new LLMAuthenticationError(message, { status, code, cause: error });
    case 402:
      throw new LLMInsufficientBalanceError(message, { status, code, cause: error });
    case 429:
      throw new LLMRateLimitError(message, { status, code, cause: error });
    case 500:
      throw new LLMServerError(message, { status, code, cause: error });
    case 503:
      throw new LLMServerOverloadedError(message, { status, code, cause: error });
    default:
      throw new LLMError(message, { status, code, cause: error });
  }
}
