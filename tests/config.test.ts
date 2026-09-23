import { describe, it, expect, vi } from 'vitest';
import { parseConfig } from '../src/config';

describe('Config', () => {
  it('should apply valid default settings when only required variables are provided', () => {
    const config = parseConfig({
      DEEPSEEK_API_KEY: 'test-key',
      SYSTEM_PROMPT: 'test-prompt',
    });

    expect(config.DEEPSEEK_API_KEY).toBe('test-key');
    expect(config.SYSTEM_PROMPT).toBe('test-prompt');
    expect(config.DEEPSEEK_BASE_URL).toBe('https://api.deepseek.com');
    expect(config.DEEPSEEK_MODEL).toBe('deepseek-flash');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.MAX_TOOL_ITERATIONS).toBe(5);
    expect(config.MAX_HISTORY_TURNS).toBe(10);
  });

  it('should correctly override defaults with provided custom variables', () => {
    const config = parseConfig({
      DEEPSEEK_API_KEY: 'custom-key',
      SYSTEM_PROMPT: 'custom-prompt',
      DEEPSEEK_BASE_URL: 'https://custom.endpoint.com',
      DEEPSEEK_MODEL: 'deepseek-chat',
      LOG_LEVEL: 'debug',
      MAX_TOOL_ITERATIONS: '10',
      MAX_HISTORY_TURNS: '25',
    });

    expect(config.DEEPSEEK_API_KEY).toBe('custom-key');
    expect(config.SYSTEM_PROMPT).toBe('custom-prompt');
    expect(config.DEEPSEEK_BASE_URL).toBe('https://custom.endpoint.com');
    expect(config.DEEPSEEK_MODEL).toBe('deepseek-chat');
    expect(config.LOG_LEVEL).toBe('debug');
    expect(config.MAX_TOOL_ITERATIONS).toBe(10);
    expect(config.MAX_HISTORY_TURNS).toBe(25);
  });

  it('should throw an error and log failure when required variables are missing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => parseConfig({})).toThrow('Invalid environment variables');
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
