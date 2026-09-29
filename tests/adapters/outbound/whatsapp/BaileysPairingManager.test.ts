import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaileysPairingManager } from '../../../../src/adapters/outbound/whatsapp/BaileysPairingManager';
import { LoggerPort } from '../../../../src/core/ports/LoggerPort';

describe('BaileysPairingManager', () => {
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

  describe('pair', () => {
    it('should initiate pairing when device is not registered and log instructions', async () => {
      const manager = new BaileysPairingManager(mockLogger);
      const mockSock = {
        requestPairingCode: vi.fn().mockResolvedValue('ABC1-23XY'),
        authState: {
          creds: { registered: false },
        },
      };

      const code = await manager.pair(mockSock, '919876543210');

      expect(code).toBe('ABC1-23XY');
      expect(mockSock.requestPairingCode).toHaveBeenCalledWith('919876543210');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('WhatsApp pairing code'),
        expect.objectContaining({ pairingCode: 'ABC1-23XY' })
      );
    });

    it('should sanitize formatted phone numbers with non-digits', async () => {
      const manager = new BaileysPairingManager(mockLogger);
      const mockSock = {
        requestPairingCode: vi.fn().mockResolvedValue('XYZ9-87AB'),
        authState: {
          creds: { registered: false },
        },
      };

      const code = await manager.pair(mockSock, '+91 (987) 654-3210');

      expect(code).toBe('XYZ9-87AB');
      expect(mockSock.requestPairingCode).toHaveBeenCalledWith('919876543210');
    });

    it('should skip pairing if device is already registered', async () => {
      const manager = new BaileysPairingManager(mockLogger);
      const mockSock = {
        requestPairingCode: vi.fn(),
        authState: {
          creds: { registered: true },
        },
      };

      const code = await manager.pair(mockSock, '919876543210');

      expect(code).toBeNull();
      expect(mockSock.requestPairingCode).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('already registered')
      );
    });

    it('should log error and rethrow when sock.requestPairingCode fails', async () => {
      const manager = new BaileysPairingManager(mockLogger);
      const pairingError = new Error('Connection timed out');
      const mockSock = {
        requestPairingCode: vi.fn().mockRejectedValue(pairingError),
        authState: {
          creds: { registered: false },
        },
      };

      await expect(manager.pair(mockSock, '919876543210')).rejects.toThrow(
        'Connection timed out'
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to pair WhatsApp device',
        pairingError
      );
    });
  });
});
