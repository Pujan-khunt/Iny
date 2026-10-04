import { describe, it, expect, vi } from 'vitest';
import { parseConfig, loadConfig } from '../src/config';

describe('Config', () => {
  it('should apply valid default settings when only required variables are provided', () => {
    const config = parseConfig({
      DEEPSEEK_API_KEY: 'test-key',
      SYSTEM_PROMPT: 'test-prompt',
      BOT_PHONE_NUMBER: '15551234567',
      ALLOWED_USERS: '15559876543, 15550001111@s.whatsapp.net',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/iny',
    });

    expect(config.DEEPSEEK_API_KEY).toBe('test-key');
    expect(config.SYSTEM_PROMPT).toBe('test-prompt');
    expect(config.BOT_PHONE_NUMBER).toBe('15551234567');
    expect(config.ALLOWED_USERS).toEqual(['15559876543', '15550001111@s.whatsapp.net']);
    expect(config.DATABASE_URL).toBe('postgresql://postgres:postgres@localhost:5432/iny');
    expect(config.DB_MAX_CONNECTIONS).toBe(10);
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
      BOT_PHONE_NUMBER: '15551234567',
      ALLOWED_USERS: '15559876543',
      DATABASE_URL: 'postgres://custom_user:pass@db.example.com:5432/custom_db',
      DB_MAX_CONNECTIONS: '25',
      DEEPSEEK_BASE_URL: 'https://custom.endpoint.com',
      DEEPSEEK_MODEL: 'deepseek-chat',
      LOG_LEVEL: 'debug',
      MAX_TOOL_ITERATIONS: '10',
      MAX_HISTORY_TURNS: '25',
    });

    expect(config.DATABASE_URL).toBe('postgres://custom_user:pass@db.example.com:5432/custom_db');
    expect(config.DB_MAX_CONNECTIONS).toBe(25);
  });

  it('should default ALLOWED_USERS and ALLOWED_USER_NAMES to empty array when omitted from environment', () => {
    const config = parseConfig({
      DEEPSEEK_API_KEY: 'test-key',
      SYSTEM_PROMPT: 'test-prompt',
      BOT_PHONE_NUMBER: '15551234567',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/iny',
    });

    expect(config.ALLOWED_USERS).toEqual([]);
    expect(config.ALLOWED_USER_NAMES).toEqual([]);
  });

  it('should parse empty or whitespace ALLOWED_USERS and ALLOWED_USER_NAMES into empty array', () => {
    const configEmpty = parseConfig({
      DEEPSEEK_API_KEY: 'test-key',
      SYSTEM_PROMPT: 'test-prompt',
      BOT_PHONE_NUMBER: '15551234567',
      ALLOWED_USERS: '',
      ALLOWED_USER_NAMES: '',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/iny',
    });
    expect(configEmpty.ALLOWED_USERS).toEqual([]);
    expect(configEmpty.ALLOWED_USER_NAMES).toEqual([]);

    const configWhitespace = parseConfig({
      DEEPSEEK_API_KEY: 'test-key',
      SYSTEM_PROMPT: 'test-prompt',
      BOT_PHONE_NUMBER: '15551234567',
      ALLOWED_USERS: '   ,  , ',
      ALLOWED_USER_NAMES: '   ,  , ',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/iny',
    });
    expect(configWhitespace.ALLOWED_USERS).toEqual([]);
    expect(configWhitespace.ALLOWED_USER_NAMES).toEqual([]);
  });

  it('should parse comma-separated ALLOWED_USER_NAMES into string array', () => {
    const config = parseConfig({
      DEEPSEEK_API_KEY: 'test-key',
      SYSTEM_PROMPT: 'test-prompt',
      BOT_PHONE_NUMBER: '15551234567',
      ALLOWED_USERS: '15551234567, 15559876543',
      ALLOWED_USER_NAMES: 'Pujan, Alice',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/iny',
    });
    expect(config.ALLOWED_USER_NAMES).toEqual(['Pujan', 'Alice']);
  });

  it('should preserve empty slots in ALLOWED_USER_NAMES for positional correlation', () => {
    const config = parseConfig({
      DEEPSEEK_API_KEY: 'test-key',
      SYSTEM_PROMPT: 'test-prompt',
      BOT_PHONE_NUMBER: '15551234567',
      ALLOWED_USERS: '15551111111, 15552222222, 15553333333',
      ALLOWED_USER_NAMES: 'Alice, , Charlie',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/iny',
    });
    expect(config.ALLOWED_USER_NAMES).toEqual(['Alice', '', 'Charlie']);
  });

  it('should throw an error and log failure when required variables are missing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => parseConfig({})).toThrow('Invalid environment variables');
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('should reject invalid BOT_PHONE_NUMBER containing non-digit characters', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() =>
      parseConfig({
        DEEPSEEK_API_KEY: 'test-key',
        SYSTEM_PROMPT: 'test-prompt',
        BOT_PHONE_NUMBER: '+91 (987) 654-3210',
        ALLOWED_USERS: '919876543211',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/iny',
      })
    ).toThrow('Invalid environment variables');

    errorSpy.mockRestore();
  });

  it('should reject BOT_PHONE_NUMBER with fewer than 7 digits or more than 15 digits', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Too short (6 digits)
    expect(() =>
      parseConfig({
        DEEPSEEK_API_KEY: 'test-key',
        SYSTEM_PROMPT: 'test-prompt',
        BOT_PHONE_NUMBER: '123456',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/iny',
      })
    ).toThrow('Invalid environment variables');

    // Too long (16 digits)
    expect(() =>
      parseConfig({
        DEEPSEEK_API_KEY: 'test-key',
        SYSTEM_PROMPT: 'test-prompt',
        BOT_PHONE_NUMBER: '1234567890123456',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/iny',
      })
    ).toThrow('Invalid environment variables');

    errorSpy.mockRestore();
  });

  it('should throw an error when DATABASE_URL is missing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() =>
      parseConfig({
        DEEPSEEK_API_KEY: 'test-key',
        SYSTEM_PROMPT: 'test-prompt',
        BOT_PHONE_NUMBER: '15551234567',
        ALLOWED_USERS: '15559876543',
      })
    ).toThrow('Invalid environment variables');

    errorSpy.mockRestore();
  });

  it('should reject invalid DATABASE_URL not starting with postgres:// or postgresql://', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() =>
      parseConfig({
        DEEPSEEK_API_KEY: 'test-key',
        SYSTEM_PROMPT: 'test-prompt',
        BOT_PHONE_NUMBER: '15551234567',
        ALLOWED_USERS: '15559876543',
        DATABASE_URL: 'mysql://root:pass@localhost:3306/db',
      })
    ).toThrow('Invalid environment variables');

    errorSpy.mockRestore();
  });

  it('should fallback to defaults when optional or defaulted variables are empty strings or whitespace', () => {
    const config = parseConfig({
      DEEPSEEK_API_KEY: 'test-key',
      SYSTEM_PROMPT: 'test-prompt',
      BOT_PHONE_NUMBER: '15551234567',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/iny',
      ALLOWED_USERS: '',
      DEEPSEEK_BASE_URL: '   ',
      DEEPSEEK_MODEL: '',
      LOG_LEVEL: '',
      DB_MAX_CONNECTIONS: '',
      MAX_TOOL_ITERATIONS: '  ',
      MAX_HISTORY_TURNS: '',
    });

    expect(config.DEEPSEEK_BASE_URL).toBe('https://api.deepseek.com');
    expect(config.DEEPSEEK_MODEL).toBe('deepseek-flash');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.DB_MAX_CONNECTIONS).toBe(10);
    expect(config.MAX_TOOL_ITERATIONS).toBe(5);
    expect(config.MAX_HISTORY_TURNS).toBe(10);
    expect(config.ALLOWED_USERS).toEqual([]);
  });

  it('should reject empty strings for required variables without defaults', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() =>
      parseConfig({
        DEEPSEEK_API_KEY: '   ',
        SYSTEM_PROMPT: 'test-prompt',
        BOT_PHONE_NUMBER: '15551234567',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/iny',
      })
    ).toThrow('Invalid environment variables');

    errorSpy.mockRestore();
  });

  it('should load and parse config using loadConfig()', () => {
    const loaded = loadConfig({
      DEEPSEEK_API_KEY: 'test-key',
      SYSTEM_PROMPT: 'test-prompt',
      BOT_PHONE_NUMBER: '15551234567',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/iny',
    });

    expect(loaded.DEEPSEEK_API_KEY).toBe('test-key');
    expect(loaded.DEEPSEEK_MODEL).toBe('deepseek-flash');
  });
});
