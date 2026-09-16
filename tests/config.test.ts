import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

describe('Config', () => {
  const initialEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...initialEnv };
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    process.env = initialEnv;
  });

  it('should throw if DEEPSEEK_API_KEY is missing', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    await expect(import('../src/config')).rejects.toThrow();
  });

  it('should throw if DEEPSEEK_API_KEY is empty', async () => {
    process.env.DEEPSEEK_API_KEY = '';
    await expect(import('../src/config')).rejects.toThrow();
  });

  it('should export config if DEEPSEEK_API_KEY is present with default LOG_LEVEL info', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    delete process.env.LOG_LEVEL;
    const { config } = await import('../src/config');
    expect(config.DEEPSEEK_API_KEY).toBe('test_key');
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('should accept valid LOG_LEVEL values', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.LOG_LEVEL = 'debug';
    const { config } = await import('../src/config');
    expect(config.LOG_LEVEL).toBe('debug');
  });

  it('should throw if LOG_LEVEL is invalid', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.LOG_LEVEL = 'verbose';
    await expect(import('../src/config')).rejects.toThrow();
  });
});
