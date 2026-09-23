import { describe, it, expect } from 'vitest';
import { translateAndThrowDeepseekError } from '../../../../src/adapters/outbound/llm/DeepseekErrorTranslator';
import {
  LLMAuthenticationError,
  LLMInsufficientBalanceError,
  LLMRateLimitError,
  LLMServerError,
  LLMServerOverloadedError,
  LLMInvalidRequestError,
  LLMError,
} from '../../../../src/core/errors/LLMErrors';

describe('DeepseekErrorTranslator', () => {
  it('should translate 401 to LLMAuthenticationError', () => {
    expect(() =>
      translateAndThrowDeepseekError({ status: 401, message: 'Unauthorized' })
    ).toThrow(LLMAuthenticationError);
  });

  it('should translate 402 to LLMInsufficientBalanceError', () => {
    expect(() =>
      translateAndThrowDeepseekError({ status: 402, message: 'No credits' })
    ).toThrow(LLMInsufficientBalanceError);
  });

  it('should translate 429 to LLMRateLimitError', () => {
    expect(() =>
      translateAndThrowDeepseekError({ status: 429, message: 'Too many requests' })
    ).toThrow(LLMRateLimitError);
  });

  it('should translate 500 to LLMServerError and 503 to LLMServerOverloadedError', () => {
    expect(() =>
      translateAndThrowDeepseekError({ status: 500, message: 'Server err' })
    ).toThrow(LLMServerError);
    expect(() =>
      translateAndThrowDeepseekError({ status: 503, message: 'Overloaded' })
    ).toThrow(LLMServerOverloadedError);
  });

  it('should translate 400 or 422 to LLMInvalidRequestError', () => {
    expect(() =>
      translateAndThrowDeepseekError({ status: 400, message: 'Bad request' })
    ).toThrow(LLMInvalidRequestError);
    expect(() =>
      translateAndThrowDeepseekError({ status: 422, message: 'Unprocessable' })
    ).toThrow(LLMInvalidRequestError);
  });

  it('should translate unexpected status or generic error to base LLMError', () => {
    expect(() =>
      translateAndThrowDeepseekError({ status: 502, message: 'Bad Gateway' })
    ).toThrow(LLMError);
    expect(() =>
      translateAndThrowDeepseekError(new Error('Unknown network glitch'))
    ).toThrow(LLMError);
  });

  it('should rethrow existing LLMError without modification', () => {
    const existing = new LLMError('Custom error');
    expect(() => translateAndThrowDeepseekError(existing)).toThrow(existing);
  });
});
