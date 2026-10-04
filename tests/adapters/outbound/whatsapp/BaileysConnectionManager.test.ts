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

    it('should end socket and clear reference on disconnect()', () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const mockSocket = {
        end: vi.fn(),
      };

      manager.setSocket(mockSocket as any);
      expect(manager.isConnected()).toBe(true);

      manager.disconnect();

      expect(mockSocket.end).toHaveBeenCalledWith(undefined);
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
        end: vi.fn(),
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

    it('should suppress reconnect attempts and log shutdown when closed after disconnect()', async () => {
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
        manager.disconnect();

        await capturedProcessHandler!({
          'connection.update': {
            connection: 'close',
            lastDisconnect: { error: new Error('Stream closed') },
          },
        });

        expect(mockLogger.info).toHaveBeenCalledWith('WhatsApp connection closed during shutdown');
        expect(mockLogger.warn).not.toHaveBeenCalledWith(
          'WhatsApp connection closed. Attempting reconnect.',
          expect.anything(),
          expect.anything()
        );

        vi.advanceTimersByTime(5000);
        expect(startSpy).toHaveBeenCalledTimes(1); // not called again
      } finally {
        vi.useRealTimers();
      }
    });

    it('should clear any pending reconnect timer when disconnect() is called', async () => {
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

        // Connection close with transient error triggers a reconnect in 3s
        const boomError = new Boom('Connection lost', {
          statusCode: DisconnectReason.connectionLost,
        });
        await capturedProcessHandler!({
          'connection.update': {
            connection: 'close',
            lastDisconnect: { error: boomError },
          },
        });

        expect(mockLogger.info).toHaveBeenCalledWith('Restarting in 3 seconds');

        // Disconnect called before 3s timer elapses
        manager.disconnect();

        vi.advanceTimersByTime(5000);
        expect(startSpy).toHaveBeenCalledTimes(1); // not called again
      } finally {
        vi.useRealTimers();
      }
    });

    it('should dispatch events to subscribed handlers when sock.ev.process receives matching events', async () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const mockUpsertHandler = vi.fn().mockResolvedValue(undefined);
      manager.subscribe('messages.upsert', mockUpsertHandler);

      const options = {
        session: {
          state: { creds: { registered: true } as any, keys: {} as any },
          saveCreds: vi.fn().mockResolvedValue(undefined),
        },
        botPhoneNumber: '919876543210',
      };

      await manager.start(options);

      const eventPayload = {
        type: 'notify' as const,
        messages: [
          {
            key: { id: 'msg-1', remoteJid: '919876543210@s.whatsapp.net', fromMe: false },
            message: { conversation: 'Hello' },
          },
        ] as any,
      };

      await capturedProcessHandler!({
        'messages.upsert': eventPayload,
      });

      expect(mockUpsertHandler).toHaveBeenCalledWith(eventPayload);
    });

    it('should unsubscribe handler when returned unsubscribe function is called', async () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const mockUpsertHandler = vi.fn().mockResolvedValue(undefined);
      const unsubscribe = manager.subscribe('messages.upsert', mockUpsertHandler);

      const options = {
        session: {
          state: { creds: { registered: true } as any, keys: {} as any },
          saveCreds: vi.fn().mockResolvedValue(undefined),
        },
        botPhoneNumber: '919876543210',
      };

      await manager.start(options);

      unsubscribe();

      await capturedProcessHandler!({
        'messages.upsert': {
          type: 'notify' as const,
          messages: [],
        },
      });

      expect(mockUpsertHandler).not.toHaveBeenCalled();
    });

    it('should dispatch events to multiple subscribers for the same event', async () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const handler1 = vi.fn().mockResolvedValue(undefined);
      const handler2 = vi.fn().mockResolvedValue(undefined);

      manager.subscribe('messages.upsert', handler1);
      manager.subscribe('messages.upsert', handler2);

      const options = {
        session: {
          state: { creds: { registered: true } as any, keys: {} as any },
          saveCreds: vi.fn().mockResolvedValue(undefined),
        },
        botPhoneNumber: '919876543210',
      };

      await manager.start(options);

      const eventPayload = {
        type: 'notify' as const,
        messages: [],
      };

      await capturedProcessHandler!({
        'messages.upsert': eventPayload,
      });

      expect(handler1).toHaveBeenCalledWith(eventPayload);
      expect(handler2).toHaveBeenCalledWith(eventPayload);
    });

    it('should execute multiple handlers concurrently without blocking sibling handlers', async () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const executionOrder: string[] = [];

      let resolveSlowHandler!: () => void;
      const slowHandler = vi.fn().mockImplementation(async () => {
        executionOrder.push('slow-start');
        await new Promise<void>((resolve) => {
          resolveSlowHandler = resolve;
        });
        executionOrder.push('slow-end');
      });

      const fastHandler = vi.fn().mockImplementation(async () => {
        executionOrder.push('fast-start');
        executionOrder.push('fast-end');
      });

      manager.subscribe('messages.upsert', slowHandler);
      manager.subscribe('messages.upsert', fastHandler);

      const options = {
        session: {
          state: { creds: { registered: true } as any, keys: {} as any },
          saveCreds: vi.fn().mockResolvedValue(undefined),
        },
        botPhoneNumber: '919876543210',
      };

      await manager.start(options);

      const eventPayload = {
        type: 'notify' as const,
        messages: [],
      };

      const processPromise = capturedProcessHandler!({
        'messages.upsert': eventPayload,
      });

      // Both should have started and fastHandler should have completed even while slowHandler is still pending
      expect(slowHandler).toHaveBeenCalledTimes(1);
      expect(fastHandler).toHaveBeenCalledTimes(1);
      expect(executionOrder).toEqual(['slow-start', 'fast-start', 'fast-end']);

      // Now resolve slow handler
      resolveSlowHandler();
      await processPromise;

      expect(executionOrder).toEqual(['slow-start', 'fast-start', 'fast-end', 'slow-end']);
    });

    it('should isolate errors so a rejected handler does not prevent sibling handlers from running and logs error', async () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const error = new Error('Handler crash');
      const failingHandler = vi.fn().mockRejectedValue(error);
      const succeedingHandler = vi.fn().mockResolvedValue(undefined);

      manager.subscribe('messages.upsert', failingHandler);
      manager.subscribe('messages.upsert', succeedingHandler);

      const options = {
        session: {
          state: { creds: { registered: true } as any, keys: {} as any },
          saveCreds: vi.fn().mockResolvedValue(undefined),
        },
        botPhoneNumber: '919876543210',
      };

      await manager.start(options);

      const eventPayload = {
        type: 'notify' as const,
        messages: [],
      };

      await capturedProcessHandler!({
        'messages.upsert': eventPayload,
      });

      expect(failingHandler).toHaveBeenCalledTimes(1);
      expect(succeedingHandler).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Handler failed for event "messages.upsert"',
        error,
        { eventName: 'messages.upsert' }
      );
    });

    it('should safely catch synchronous throws from handlers without crashing', async () => {
      const manager = new BaileysConnectionManager(mockLogger, mockPairingManager, mockSessionManager);
      const syncError = new Error('Sync throw');
      const throwingHandler = vi.fn().mockImplementation(() => {
        throw syncError;
      });
      const siblingHandler = vi.fn().mockResolvedValue(undefined);

      manager.subscribe('messages.upsert', throwingHandler);
      manager.subscribe('messages.upsert', siblingHandler);

      const options = {
        session: {
          state: { creds: { registered: true } as any, keys: {} as any },
          saveCreds: vi.fn().mockResolvedValue(undefined),
        },
        botPhoneNumber: '919876543210',
      };

      await manager.start(options);

      const eventPayload = {
        type: 'notify' as const,
        messages: [],
      };

      await capturedProcessHandler!({
        'messages.upsert': eventPayload,
      });

      expect(throwingHandler).toHaveBeenCalledTimes(1);
      expect(siblingHandler).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Handler failed for event "messages.upsert"',
        syncError,
        { eventName: 'messages.upsert' }
      );
    });
  });
});
