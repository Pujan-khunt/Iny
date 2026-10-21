export class LLMError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly rawResponse?: string;

  constructor(
    message: string,
    options?: { status?: number; code?: string; cause?: unknown; rawResponse?: string }
  ) {
    super(message, { cause: options?.cause });
    this.name = this.constructor.name;
    this.status = options?.status;
    this.code = options?.code;
    this.rawResponse = options?.rawResponse;
  }
}

export class LLMAuthenticationError extends LLMError {}
export class LLMInsufficientBalanceError extends LLMError {}
export class LLMInvalidRequestError extends LLMError {}
export class LLMRateLimitError extends LLMError {}
export class LLMServerError extends LLMError {}
export class LLMServerOverloadedError extends LLMError {}
export class LLMResponseError extends LLMError {}
