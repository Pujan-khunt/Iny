import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeResetWithGuards } from '../../scripts/reset-mess.js';

describe('Development Reset Utility Guards', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('Guard 1: Environment Gate', () => {
    it('aborts immediately when NODE_ENV is production via options', async () => {
      await expect(
        executeResetWithGuards({
          nodeEnv: 'production',
          databaseUrl: 'postgres://localhost/iny_prod',
          confirmNameInput: 'iny_prod',
        })
      ).rejects.toThrow(/Refusing to run destructive reset in production environment/);
    });

    it('aborts immediately when process.env.NODE_ENV is production and not overridden', async () => {
      process.env.NODE_ENV = 'production';
      await expect(
        executeResetWithGuards({
          databaseUrl: 'postgres://localhost/iny_prod',
          confirmNameInput: 'iny_prod',
        })
      ).rejects.toThrow(/Refusing to run destructive reset in production environment/);
    });

    it('does not abort for non-production environments (development, test)', async () => {
      const mockRepo = { atomicReset: vi.fn().mockResolvedValue(undefined) };
      await expect(
        executeResetWithGuards({
          nodeEnv: 'development',
          databaseUrl: 'postgres://localhost/iny_dev',
          confirmNameInput: 'iny_dev',
          stagingRepo: mockRepo,
        })
      ).resolves.not.toThrow();
      expect(mockRepo.atomicReset).toHaveBeenCalledTimes(1);
    });
  });

  describe('Guard 2: Host Inspection & Target DB Display', () => {
    it('throws if databaseUrl is missing or invalid', async () => {
      await expect(
        executeResetWithGuards({
          nodeEnv: 'development',
          databaseUrl: '',
          confirmNameInput: 'iny_dev',
        })
      ).rejects.toThrow(/DATABASE_URL is required/);

      await expect(
        executeResetWithGuards({
          nodeEnv: 'development',
          databaseUrl: 'not-a-valid-url',
          confirmNameInput: 'iny_dev',
        })
      ).rejects.toThrow(/Invalid database URL/);
    });

    it('parses databaseUrl, extracts database name and host, and prints them', async () => {
      const prints: string[] = [];
      const mockRepo = { atomicReset: vi.fn().mockResolvedValue(undefined) };

      await executeResetWithGuards({
        nodeEnv: 'development',
        databaseUrl: 'postgres://operator:secret@db.host.internal:5432/iny_test_db',
        confirmNameInput: 'iny_test_db',
        stagingRepo: mockRepo,
        io: {
          print: (msg) => prints.push(msg),
        },
      });

      expect(prints.some((p) => p.includes('db.host.internal:5432') && p.includes('iny_test_db'))).toBe(true);
    });
  });

  describe('Guard 3: Explicit Name Challenge', () => {
    it('aborts when typed database name does not match target database', async () => {
      await expect(
        executeResetWithGuards({
          nodeEnv: 'development',
          databaseUrl: 'postgres://localhost/iny_dev',
          confirmNameInput: 'wrong_name',
        })
      ).rejects.toThrow(/Confirmation name does not match/);
    });

    it('prompts operator interactively when confirmNameInput is not provided', async () => {
      const mockPrompt = vi.fn().mockResolvedValue('iny_dev');
      const mockRepo = { atomicReset: vi.fn().mockResolvedValue(undefined) };

      await executeResetWithGuards({
        nodeEnv: 'development',
        databaseUrl: 'postgres://localhost:5432/iny_dev',
        stagingRepo: mockRepo,
        io: {
          print: () => {},
          prompt: mockPrompt,
        },
      });

      expect(mockPrompt).toHaveBeenCalledWith(expect.stringContaining('iny_dev'));
      expect(mockRepo.atomicReset).toHaveBeenCalledTimes(1);
    });

    it('aborts when interactive prompt returns mismatched database name', async () => {
      const mockPrompt = vi.fn().mockResolvedValue('wrong_database');
      const mockRepo = { atomicReset: vi.fn().mockResolvedValue(undefined) };

      await expect(
        executeResetWithGuards({
          nodeEnv: 'development',
          databaseUrl: 'postgres://localhost:5432/iny_dev',
          stagingRepo: mockRepo,
          io: {
            print: () => {},
            prompt: mockPrompt,
          },
        })
      ).rejects.toThrow('Confirmation name does not match target database name ("iny_dev"). Aborting reset.');

      expect(mockRepo.atomicReset).not.toHaveBeenCalled();
    });
  });

  describe('Reset Execution', () => {
    it('calls stagingRepo.atomicReset() on matching confirmation', async () => {
      const mockRepo = { atomicReset: vi.fn().mockResolvedValue(undefined) };
      const prints: string[] = [];

      await executeResetWithGuards({
        nodeEnv: 'development',
        databaseUrl: 'postgres://localhost/iny_dev',
        confirmNameInput: 'iny_dev',
        stagingRepo: mockRepo,
        io: {
          print: (msg) => prints.push(msg),
        },
      });

      expect(mockRepo.atomicReset).toHaveBeenCalledTimes(1);
      expect(prints.some((p) => p.toLowerCase().includes('success'))).toBe(true);
    });
  });
});
