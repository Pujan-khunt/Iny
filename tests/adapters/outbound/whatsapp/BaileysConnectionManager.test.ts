import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Boom } from '@hapi/boom';
import makeWASocket, { DisconnectReason, proto } from '@whiskeysockets/baileys';
import { BaileysConnectionManager } from '../../../../src/adapters/outbound/whatsapp/BaileysConnectionManager';
import { BaileysPairingManager } from '../../../../src/adapters/outbound/whatsapp/BaileysPairingManager';
import { BaileysSessionManagerPort } from '../../../../src/adapters/outbound/whatsapp/PostgresBaileysSessionManager';
import { LoggerPort } from '../../../../src/core/ports/LoggerPort';

vi.mock('@whiskeysockets/baileys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@whiskeysockets/baileys')>();
  const mockMakeWASocket = vi.fn();
  return {
    ...actual,
    default: mockMakeWASocket,
    makeWASocket: mockMakeWASocket,
  };
});

describe('BaileysConnectionManager', () => {
  let mockLogger: LoggerPort;
  let mockPairingManager: BaileysPairingManager;
  let mockSessionManager: BaileysSessionManagerPort;

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
    mockPairingManager = new BaileysPairingManager(mockLogger);
    mockSessionManager = {
      initSession: vi.fn(),
      purgeSession: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe('connection status', () => {
    it('should report disconnected initially', () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      expect(manager.isConnected()).toBe(false);
    });

    it('should report connected when a socket is set, and disconnected when cleared', () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const mockSocket = {
        sendMessage: vi.fn(),
        ev: { on: vi.fn(), process: vi.fn() },
      };

      manager.setSocket(mockSocket as any);
      expect(manager.isConnected()).toBe(true);
      expect(manager.getSocket()).toBe(mockSocket);

      manager.setSocket(null);
      expect(manager.isConnected()).toBe(false);
      expect(manager.getSocket()).toBeNull();
    });
  });

  describe('handleConnectionClose', () => {
    it('should recommend immediate reconnect on DisconnectReason.restartRequired (515)', () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const boomError = new Boom('Restart required', {
        statusCode: DisconnectReason.restartRequired,
      });

      const result = manager.handleConnectionClose(boomError);
      expect(result.shouldReconnect).toBe(true);
      expect(result.purgeSession).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'WhatsApp restart required by server. Reconnecting immediately.'
      );
    });

    it('should recommend reconnect on transient connectionClosed (428) or timedOut (408)', () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const boomError = new Boom('Connection lost', {
        statusCode: DisconnectReason.connectionLost,
      });

      const result = manager.handleConnectionClose(boomError);
      expect(result.shouldReconnect).toBe(true);
      expect(result.purgeSession).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'WhatsApp connection closed. Attempting reconnect.',
        boomError,
        { statusCode: DisconnectReason.connectionLost }
      );
    });

    it('should recommend session purge and NO reconnect on DisconnectReason.loggedOut (401)', () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const boomError = new Boom('Device logged out', {
        statusCode: DisconnectReason.loggedOut,
      });

      const result = manager.handleConnectionClose(boomError);
      expect(result.shouldReconnect).toBe(false);
      expect(result.purgeSession).toBe(true);
      expect(mockLogger.fatal).toHaveBeenCalledWith(
        'WhatsApp session was logged out by the device. Credential purge required.'
      );
    });

    it('should log fatal error and abort reconnect without purge on DisconnectReason.badSession (500)', () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const boomError = new Boom('Bad session', {
        statusCode: DisconnectReason.badSession,
      });

      const result = manager.handleConnectionClose(boomError);
      expect(result.shouldReconnect).toBe(false);
      expect(result.purgeSession).toBe(false);
      expect(mockLogger.fatal).toHaveBeenCalledWith(
        'WhatsApp session corrupted or invalid (badSession). Manual restart required.'
      );
    });

    it('should handle non-Boom or unknown errors by warning and recommending reconnect', () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const genericError = new Error('Socket pipe broken');

      const result = manager.handleConnectionClose(genericError);
      expect(result.shouldReconnect).toBe(true);
      expect(result.purgeSession).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'WhatsApp connection closed. Attempting reconnect.',
        genericError,
        undefined
      );
    });

    it('should handle undefined disconnect error gracefully', () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);

      const result = manager.handleConnectionClose(undefined);
      expect(result.shouldReconnect).toBe(true);
      expect(result.purgeSession).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'WhatsApp connection closed. Attempting reconnect.',
        undefined,
        undefined
      );
    });
  });

  describe('start & socket lifecycle', () => {
    let capturedProcessHandler: ((events: Record<string, any>) => Promise<void>) | null = null;
    let mockSocket: any;

    beforeEach(() => {
      capturedProcessHandler = null;
      mockSocket = {
        sendMessage: vi.fn().mockResolvedValue({}),
        authState: {
          creds: { registered: false },
        },
        ev: {
          process: vi.fn().mockImplementation((handler) => {
            capturedProcessHandler = handler;
          }),
        },
      };
      vi.mocked(makeWASocket).mockReturnValue(mockSocket);
    });

    it('should initialize socket and set it as active', async () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const options = {
        session: {
          state: { creds: { registered: false } as any, keys: {} as any },
          saveCreds: vi.fn().mockResolvedValue(undefined),
        },
        botPhoneNumber: '919876543210',
      };

      await manager.start(options);

      expect(makeWASocket).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: options.session.state,
        })
      );
      expect(manager.isConnected()).toBe(true);
    });

    it('should save credentials when creds.update event is emitted', async () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const saveCredsMock = vi.fn().mockResolvedValue(undefined);
      const options = {
        session: {
          state: { creds: { registered: false } as any, keys: {} as any },
          saveCreds: saveCredsMock,
        },
        botPhoneNumber: '919876543210',
      };

      await manager.start(options);
      expect(capturedProcessHandler).not.toBeNull();

      await capturedProcessHandler!({
        'creds.update': true,
      });

      expect(saveCredsMock).toHaveBeenCalledTimes(1);
    });

    it('should initiate pairing when qr emitted and device is unregistered', async () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const pairSpy = vi
        .spyOn(mockPairingManager, 'pair')
        .mockResolvedValue('ABC1-23XY');

      const options = {
        session: {
          state: { creds: { registered: false } as any, keys: {} as any },
          saveCreds: vi.fn().mockResolvedValue(undefined),
        },
        botPhoneNumber: '919876543210',
      };

      await manager.start(options);
      await capturedProcessHandler!({
        'connection.update': {
          qr: 'mock-qr-raw-data',
        },
      });

      expect(pairSpy).toHaveBeenCalledWith(mockSocket, '919876543210');
    });

    it('should not initiate pairing when qr emitted but device is already registered', async () => {
      mockSocket.authState.creds.registered = true;
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const pairSpy = vi
        .spyOn(mockPairingManager, 'pair')
        .mockResolvedValue(null);

      const options = {
        session: {
          state: { creds: { registered: true } as any, keys: {} as any },
          saveCreds: vi.fn().mockResolvedValue(undefined),
        },
        botPhoneNumber: '919876543210',
      };

      await manager.start(options);
      await capturedProcessHandler!({
        'connection.update': {
          qr: 'mock-qr-raw-data',
        },
      });

      expect(pairSpy).not.toHaveBeenCalled();
    });

    it('should log info when connection opens', async () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const options = {
        session: {
          state: { creds: { registered: true } as any, keys: {} as any },
          saveCreds: vi.fn().mockResolvedValue(undefined),
        },
        botPhoneNumber: '919876543210',
      };

      await manager.start(options);
      await capturedProcessHandler!({
        'connection.update': {
          connection: 'open',
        },
      });

      expect(mockLogger.info).toHaveBeenCalledWith('WhatsApp connection opened successfully');
    });

    it('should clear socket and schedule reconnect on transient connection close', async () => {
      vi.useFakeTimers();
      try {
        const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
        const startSpy = vi.spyOn(manager, 'start');
        const options = {
          session: {
          state: { creds: { registered: true } as any, keys: {} as any },
          saveCreds: vi.fn().mockResolvedValue(undefined),
        },
          botPhoneNumber: '919876543210',
        };

        await manager.start(options);
        expect(manager.isConnected()).toBe(true);

        const boomError = new Boom('Connection lost', {
          statusCode: DisconnectReason.connectionLost,
        });

        await capturedProcessHandler!({
          'connection.update': {
            connection: 'close',
            lastDisconnect: { error: boomError },
          },
        });

        expect(manager.isConnected()).toBe(false);
        expect(mockLogger.info).toHaveBeenCalledWith('Restarting in 3 seconds');

        // Advance timer to trigger reconnect
        expect(startSpy).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(3000);
        expect(startSpy).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should clear socket and NOT reconnect on loggedOut connection close', async () => {
      vi.useFakeTimers();
      try {
        const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
        const startSpy = vi.spyOn(manager, 'start');
        const options = {
          session: {
          state: { creds: { registered: true } as any, keys: {} as any },
          saveCreds: vi.fn().mockResolvedValue(undefined),
        },
          botPhoneNumber: '919876543210',
        };

        await manager.start(options);
        const boomError = new Boom('Device logged out', {
          statusCode: DisconnectReason.loggedOut,
        });

        await capturedProcessHandler!({
          'connection.update': {
            connection: 'close',
            lastDisconnect: { error: boomError },
          },
        });

        expect(manager.isConnected()).toBe(false);

        vi.advanceTimersByTime(5000);
        expect(startSpy).toHaveBeenCalledTimes(1); // not called again
      } finally {
        vi.useRealTimers();
      }
    });

    it('should purge session credentials when purgeSession is true on loggedOut', async () => {
      const purgeSpy = vi.spyOn(mockSessionManager, 'purgeSession').mockResolvedValue(undefined);
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const options = {
        session: {
          state: { creds: { registered: true } as any, keys: {} as any },
          saveCreds: vi.fn().mockResolvedValue(undefined),
        },
        botPhoneNumber: '919876543210',
      };

      await manager.start(options);
      const boomError = new Boom('Device logged out', {
        statusCode: DisconnectReason.loggedOut,
      });

      await capturedProcessHandler!({
        'connection.update': {
          connection: 'close',
          lastDisconnect: { error: boomError },
        },
      });

      expect(purgeSpy).toHaveBeenCalledTimes(1);
    });

    it('should log error when session purge fails on loggedOut', async () => {
      const purgeError = new Error('Disk error');
      vi.spyOn(mockSessionManager, 'purgeSession').mockRejectedValue(purgeError);
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const options = {
        session: {
          state: { creds: { registered: true } as any, keys: {} as any },
          saveCreds: vi.fn().mockResolvedValue(undefined),
        },
        botPhoneNumber: '919876543210',
      };

      await manager.start(options);
      const boomError = new Boom('Device logged out', {
        statusCode: DisconnectReason.loggedOut,
      });

      await capturedProcessHandler!({
        'connection.update': {
          connection: 'close',
          lastDisconnect: { error: boomError },
        },
      });

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to purge session credentials', purgeError);
    });

    it('should clear socket and NOT reconnect or purge session on badSession connection close', async () => {
      vi.useFakeTimers();
      try {
        const purgeSpy = vi.spyOn(mockSessionManager, 'purgeSession').mockResolvedValue(undefined);
        const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
        const startSpy = vi.spyOn(manager, 'start');
        const options = {
          session: {
          state: { creds: { registered: true } as any, keys: {} as any },
          saveCreds: vi.fn().mockResolvedValue(undefined),
        },
          botPhoneNumber: '919876543210',
        };

        await manager.start(options);
        const boomError = new Boom('Bad session', {
          statusCode: DisconnectReason.badSession,
        });

        await capturedProcessHandler!({
          'connection.update': {
            connection: 'close',
            lastDisconnect: { error: boomError },
          },
        });

        expect(manager.isConnected()).toBe(false);
        expect(purgeSpy).not.toHaveBeenCalled();

        vi.advanceTimersByTime(5000);
        expect(startSpy).toHaveBeenCalledTimes(1); // not called again
      } finally {
        vi.useRealTimers();
      }
    });

    it('should dispatch notify messages to onIncomingMessages handler', async () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const mockUpsertHandler = vi.fn().mockResolvedValue(undefined);
      manager.onIncomingMessages(mockUpsertHandler);

      const options = {
        session: {
          state: { creds: { registered: true } as any, keys: {} as any },
          saveCreds: vi.fn().mockResolvedValue(undefined),
        },
        botPhoneNumber: '919876543210',
      };

      await manager.start(options);

      const rawMessages: proto.IWebMessageInfo[] = [
        {
          key: { id: 'msg-1', remoteJid: '919876543210@s.whatsapp.net', fromMe: false },
          message: { conversation: 'Hello' },
        },
      ];

      await capturedProcessHandler!({
        'messages.upsert': {
          type: 'notify',
          messages: rawMessages,
        },
      });

      expect(mockUpsertHandler).toHaveBeenCalledWith(rawMessages);
    });

    it('should ignore messages.upsert when type is append', async () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const mockUpsertHandler = vi.fn().mockResolvedValue(undefined);
      manager.onIncomingMessages(mockUpsertHandler);

      const options = {
        session: {
          state: { creds: { registered: true } as any, keys: {} as any },
          saveCreds: vi.fn().mockResolvedValue(undefined),
        },
        botPhoneNumber: '919876543210',
      };

      await manager.start(options);

      await capturedProcessHandler!({
        'messages.upsert': {
          type: 'append',
          messages: [],
        },
      });

      expect(mockUpsertHandler).not.toHaveBeenCalled();
    });
  });
});
