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
    delete process.env.MAX_TOOL_ITERATIONS;
    delete process.env.MAX_HISTORY_TURNS;
    const { config } = await import('../src/config');
    expect(config.DEEPSEEK_API_KEY).toBe('test_key');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.MAX_TOOL_ITERATIONS).toBe(5);
    expect(config.MAX_HISTORY_TURNS).toBe(10);
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

  it('should coerce MAX_TOOL_ITERATIONS and MAX_HISTORY_TURNS from strings', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.MAX_TOOL_ITERATIONS = '8';
    process.env.MAX_HISTORY_TURNS = '15';
    const { config } = await import('../src/config');
    expect(config.MAX_TOOL_ITERATIONS).toBe(8);
    expect(config.MAX_HISTORY_TURNS).toBe(15);
  });

  it.each([0, -1, -5])('should throw if MAX_TOOL_ITERATIONS is not positive (%d)', async (value) => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.MAX_TOOL_ITERATIONS = String(value);
    await expect(import('../src/config')).rejects.toThrow();
  });

  it('should throw if MAX_TOOL_ITERATIONS is a float', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.MAX_TOOL_ITERATIONS = '2.5';
    await expect(import('../src/config')).rejects.toThrow();
  });

  it('should throw if MAX_TOOL_ITERATIONS is not a number', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.MAX_TOOL_ITERATIONS = 'abc';
    await expect(import('../src/config')).rejects.toThrow();
  });

  it.each([0, -1, -5])('should throw if MAX_HISTORY_TURNS is not positive (%d)', async (value) => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.MAX_HISTORY_TURNS = String(value);
    await expect(import('../src/config')).rejects.toThrow();
  });

  it('should throw if MAX_HISTORY_TURNS is a float', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.MAX_HISTORY_TURNS = '3.14';
    await expect(import('../src/config')).rejects.toThrow();
  });

  it('should throw if MAX_HISTORY_TURNS is not a number', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.MAX_HISTORY_TURNS = 'xyz';
    await expect(import('../src/config')).rejects.toThrow();
  });
});
