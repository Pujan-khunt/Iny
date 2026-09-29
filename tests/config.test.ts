import { describe, it, expect, vi } from 'vitest';
import { parseConfig } from '../src/config';

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
});
