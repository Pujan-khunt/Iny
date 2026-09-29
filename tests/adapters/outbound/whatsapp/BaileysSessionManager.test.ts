import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { useMultiFileAuthState } from '@whiskeysockets/baileys';
import { BaileysSessionManager } from '../../../../src/adapters/outbound/whatsapp/BaileysSessionManager';
import { LoggerPort } from '../../../../src/core/ports/LoggerPort';

vi.mock('@whiskeysockets/baileys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@whiskeysockets/baileys')>();
  return {
    ...actual,
    useMultiFileAuthState: vi.fn(),
  };
});

describe('BaileysSessionManager', () => {
  let mockLogger: LoggerPort;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
  });

  describe('initSession', () => {
    it('should initialize auth state with default directory (.baileys_auth)', async () => {
      const mockAuthState = {
        state: { creds: { registered: false } },
        saveCreds: vi.fn(),
      };
      vi.mocked(useMultiFileAuthState).mockResolvedValue(mockAuthState as any);

      const manager = new BaileysSessionManager(mockLogger);
      const result = await manager.initSession();

      expect(useMultiFileAuthState).toHaveBeenCalledWith('.baileys_auth');
      expect(result).toBe(mockAuthState);
    });

    it('should initialize auth state with custom directory when provided', async () => {
      const mockAuthState = {
        state: { creds: { registered: true } },
        saveCreds: vi.fn(),
      };
      vi.mocked(useMultiFileAuthState).mockResolvedValue(mockAuthState as any);

      const manager = new BaileysSessionManager(mockLogger);
      const result = await manager.initSession('/tmp/custom_auth_dir');

      expect(useMultiFileAuthState).toHaveBeenCalledWith('/tmp/custom_auth_dir');
      expect(result).toBe(mockAuthState);
    });
  });

  describe('purgeSession', () => {
    it('should purge default session directory using fs.promises.rm', async () => {
      const rmSpy = vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);
      const manager = new BaileysSessionManager(mockLogger);

      await manager.purgeSession();

      expect(rmSpy).toHaveBeenCalledWith('.baileys_auth', {
        recursive: true,
        force: true,
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'WhatsApp session credentials purged successfully',
        { authDir: '.baileys_auth' }
      );
    });

    it('should purge custom session directory when configured in constructor', async () => {
      const rmSpy = vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);
      const manager = new BaileysSessionManager(mockLogger, '/tmp/custom_auth_dir');

      await manager.purgeSession();

      expect(rmSpy).toHaveBeenCalledWith('/tmp/custom_auth_dir', {
        recursive: true,
        force: true,
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'WhatsApp session credentials purged successfully',
        { authDir: '/tmp/custom_auth_dir' }
      );
    });

    it('should log error and rethrow when fs.promises.rm fails', async () => {
      const purgeError = new Error('Permission denied');
      vi.spyOn(fs.promises, 'rm').mockRejectedValue(purgeError);
      const manager = new BaileysSessionManager(mockLogger);

      await expect(manager.purgeSession()).rejects.toThrow('Permission denied');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to purge session credentials',
        purgeError,
        { authDir: '.baileys_auth' }
      );
    });
  });
});
