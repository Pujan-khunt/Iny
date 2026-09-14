import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('should throw if DEEPSEEK_API_KEY is missing', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    await expect(import('../src/config')).rejects.toThrow();
  });

  it('should throw if DEEPSEEK_API_KEY is empty', async () => {
    process.env.DEEPSEEK_API_KEY = '';
    await expect(import('../src/config')).rejects.toThrow();
  });

  it('should export config if DEEPSEEK_API_KEY is present', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    const { config } = await import('../src/config');
    expect(config.DEEPSEEK_API_KEY).toBe('test_key');
  });
});
