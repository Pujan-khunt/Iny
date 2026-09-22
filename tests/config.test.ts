import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

describe('Config', () => {
  const initialEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...initialEnv, SYSTEM_PROMPT: 'test_system_prompt' };
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

  it('should throw if SYSTEM_PROMPT is missing', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    delete process.env.SYSTEM_PROMPT;
    await expect(import('../src/config')).rejects.toThrow();
  });

  it('should throw if SYSTEM_PROMPT is empty string', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.SYSTEM_PROMPT = '';
    await expect(import('../src/config')).rejects.toThrow();
  });

  it('should export config if DEEPSEEK_API_KEY is present with default LOG_LEVEL info and default deepseek settings', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.SYSTEM_PROMPT = 'test_system_prompt';
    delete process.env.DEEPSEEK_BASE_URL;
    delete process.env.DEEPSEEK_MODEL;
    delete process.env.LOG_LEVEL;
    delete process.env.MAX_TOOL_ITERATIONS;
    delete process.env.MAX_HISTORY_TURNS;
    const { config } = await import('../src/config');
    expect(config.DEEPSEEK_API_KEY).toBe('test_key');
    expect(config.SYSTEM_PROMPT).toBe('test_system_prompt');
    expect(config.DEEPSEEK_BASE_URL).toBe('https://api.deepseek.com');
    expect(config.DEEPSEEK_MODEL).toBe('deepseek-flash');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.MAX_TOOL_ITERATIONS).toBe(5);
    expect(config.MAX_HISTORY_TURNS).toBe(10);
  });

  it('should accept custom SYSTEM_PROMPT', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.SYSTEM_PROMPT = 'Custom persona prompt for tests';
    const { config } = await import('../src/config');
    expect(config.SYSTEM_PROMPT).toBe('Custom persona prompt for tests');
  });

  it('should accept custom DEEPSEEK_BASE_URL and DEEPSEEK_MODEL', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.DEEPSEEK_BASE_URL = 'https://custom.api.endpoint.com/v1';
    process.env.DEEPSEEK_MODEL = 'deepseek-chat';
    const { config } = await import('../src/config');
    expect(config.DEEPSEEK_BASE_URL).toBe('https://custom.api.endpoint.com/v1');
    expect(config.DEEPSEEK_MODEL).toBe('deepseek-chat');
  });

  it('should throw if DEEPSEEK_BASE_URL is not a valid URL', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.DEEPSEEK_BASE_URL = 'invalid-url';
    await expect(import('../src/config')).rejects.toThrow();
  });

  it('should throw if DEEPSEEK_MODEL is empty string', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.DEEPSEEK_MODEL = '';
    await expect(import('../src/config')).rejects.toThrow();
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

  it('should throw if MAX_TOOL_ITERATIONS exceeds upper bound (20)', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.MAX_TOOL_ITERATIONS = '21';
    await expect(import('../src/config')).rejects.toThrow();
  });

  it('should accept MAX_TOOL_ITERATIONS at upper bound (20)', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.MAX_TOOL_ITERATIONS = '20';
    const { config } = await import('../src/config');
    expect(config.MAX_TOOL_ITERATIONS).toBe(20);
  });

  it('should throw if MAX_HISTORY_TURNS exceeds upper bound (100)', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.MAX_HISTORY_TURNS = '101';
    await expect(import('../src/config')).rejects.toThrow();
  });

  it('should accept MAX_HISTORY_TURNS at upper bound (100)', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.MAX_HISTORY_TURNS = '100';
    const { config } = await import('../src/config');
    expect(config.MAX_HISTORY_TURNS).toBe(100);
  });
});
