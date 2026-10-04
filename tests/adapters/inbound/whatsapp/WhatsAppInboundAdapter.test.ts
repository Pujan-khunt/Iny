import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WAMessage } from '@whiskeysockets/baileys';
import { WhatsAppInboundAdapter } from '../../../../src/adapters/inbound/whatsapp/WhatsAppInboundAdapter';
import { AccessControlPort, UserRecord } from '../../../../src/core/ports/AccessControlPort';
import { BaileysMessageFilter } from '../../../../src/adapters/inbound/whatsapp/BaileysMessageFilter';
import { BaileysMessageParser } from '../../../../src/adapters/inbound/whatsapp/BaileysMessageParser';
import { ProcessIncomingMessage } from '../../../../src/core/use-cases/ProcessIncomingMessage';
import { BaileysConnectionManager } from '../../../../src/adapters/outbound/whatsapp/BaileysConnectionManager';
import { LoggerPort } from '../../../../src/core/ports/LoggerPort';

describe('WhatsAppInboundAdapter', () => {
  let mockLogger: LoggerPort;
  let mockUseCase: ProcessIncomingMessage;
  let mockConnManager: BaileysConnectionManager;
  let mockAccessControl: AccessControlPort;
  let filter: BaileysMessageFilter;
  let parser: BaileysMessageParser;
  let adapter: WhatsAppInboundAdapter;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    mockUseCase = {
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProcessIncomingMessage;
    mockConnManager = {
      subscribe: vi.fn(),
    } as unknown as BaileysConnectionManager;
    const defaultUserRecord: UserRecord = {
      phoneNumber: '919876543210',
      pnJid: '919876543210@s.whatsapp.net',
      lidJid: '123456789012345@lid',
      name: 'Authorized User',
      role: 'user',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockAccessControl = {
      authenticate: vi.fn().mockImplementation(async (address: string) => {
        if (address.includes('919876543210') || address.includes('123456789012345')) {
          return defaultUserRecord;
        }
        return null;
      }),
      getUser: vi.fn().mockResolvedValue(null),
    };
    filter = new BaileysMessageFilter();
    parser = new BaileysMessageParser();
    adapter = new WhatsAppInboundAdapter(
      mockUseCase,
      mockConnManager,
      mockAccessControl,
      filter,
      parser,
      mockLogger
    );
  });

  describe('start', () => {
    it('should subscribe to messages.upsert on connection manager and log info', () => {
      adapter.start();

      expect(mockConnManager.subscribe).toHaveBeenCalledWith(
        'messages.upsert',
        expect.any(Function)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'WhatsApp inbound adapter listening for incoming messages'
      );
    });

    it('should handle incoming notify messages when messages.upsert event fires', async () => {
      let registeredCallback: ((data: any) => Promise<void>) | null = null;
      (mockConnManager.subscribe as any).mockImplementation((event: string, cb: any) => {
        if (event === 'messages.upsert') {
          registeredCallback = cb;
        }
      });

      adapter.start();
      expect(registeredCallback).not.toBeNull();

      const validMessage: WAMessage = {
        key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'm-cb-1' },
        message: { conversation: 'Hello through callback' },
        messageTimestamp: 1727223000,
      };

      await registeredCallback!({
        type: 'notify',
        messages: [validMessage],
      });

      expect(mockUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'm-cb-1',
          userId: '919876543210@s.whatsapp.net',
          content: 'Hello through callback',
        })
      );
    });

    it('should ignore messages.upsert when type is append', async () => {
      let registeredCallback: ((data: any) => Promise<void>) | null = null;
      (mockConnManager.subscribe as any).mockImplementation((event: string, cb: any) => {
        if (event === 'messages.upsert') {
          registeredCallback = cb;
        }
      });

      adapter.start();
      expect(registeredCallback).not.toBeNull();

      const validMessage: WAMessage = {
        key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'm-cb-2' },
        message: { conversation: 'Appended message' },
        messageTimestamp: 1727223000,
      };

      await registeredCallback!({
        type: 'append',
        messages: [validMessage],
      });

      expect(mockUseCase.execute).not.toHaveBeenCalled();
    });
  });

  describe('handleMessages', () => {
    it('should handle empty messages array safely without invoking use case', async () => {
      await adapter.handleMessages([]);

      expect(mockUseCase.execute).not.toHaveBeenCalled();
    });

    it('should skip ineligible messages (e.g. fromMe === true)', async () => {
      const selfMsg: WAMessage = {
        key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: true, id: 'self-1' },
        message: { conversation: 'I sent this' },
      };

      await adapter.handleMessages([selfMsg]);

      expect(mockUseCase.execute).not.toHaveBeenCalled();
    });

    it('should skip ineligible messages without text or from groups without calling use case', async () => {
      const nonTextMessage: WAMessage = {
        key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'm2' },
        message: { imageMessage: { caption: '' } },
      };
      const groupMessage: WAMessage = {
        key: { remoteJid: '123456789-987654@g.us', fromMe: false, id: 'm-grp' },
        message: { conversation: 'Group text' },
      };

      await adapter.handleMessages([nonTextMessage, groupMessage]);

      expect(mockUseCase.execute).not.toHaveBeenCalled();
    });

    it('should ignore incoming messages from unauthorized senders, log debug, and not call use case', async () => {
      const unauthorizedMessage: WAMessage = {
        key: { remoteJid: '919999888877@s.whatsapp.net', fromMe: false, id: 'm1' },
        message: { conversation: 'Hello stranger' },
      };

      await adapter.handleMessages([unauthorizedMessage]);

      expect(mockUseCase.execute).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Ignored message from unauthorized sender',
        { remoteJid: '919999888877@s.whatsapp.net', remoteJidAlt: undefined }
      );
    });

    it('should dispatch valid, authorized user messages to ProcessIncomingMessage.execute', async () => {
      const validMessage: WAMessage = {
        key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'm3' },
        message: { conversation: 'Calculate 10 + 20' },
        messageTimestamp: 1727223000,
      };

      await adapter.handleMessages([validMessage]);

      expect(mockUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'm3',
          userId: '919876543210@s.whatsapp.net',
          content: 'Calculate 10 + 20',
        })
      );
    });

    it('should catch parsing errors, log error, and not crash', async () => {
      const badParser = {
        parse: vi.fn().mockImplementation(() => {
          throw new Error('Corrupt message payload');
        }),
      } as unknown as BaileysMessageParser;

      const badAdapter = new WhatsAppInboundAdapter(
        mockUseCase,
        mockConnManager,
        mockAccessControl,
        filter,
        badParser,
        mockLogger
      );

      const validLookingMsg: WAMessage = {
        key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'm-corrupt' },
        message: { conversation: 'Looks valid to filter' },
      };

      await expect(badAdapter.handleMessages([validLookingMsg])).resolves.not.toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to parse eligible WhatsApp message',
        expect.any(Error)
      );
      expect(mockUseCase.execute).not.toHaveBeenCalled();
    });

    it('should catch unhandled errors from ProcessIncomingMessage.execute, log error, and not crash', async () => {
      const error = new Error('Execution failure in use case');
      (mockUseCase.execute as any).mockRejectedValue(error);

      const validMessage: WAMessage = {
        key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'm-err' },
        message: { conversation: 'Crash me' },
        messageTimestamp: 1727223000,
      };

      await expect(adapter.handleMessages([validMessage])).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unhandled error processing incoming message',
        error,
        { messageId: 'm-err' }
      );
    });

    it('should process multiple messages in a batch independently even if one throws', async () => {
      const error = new Error('Something exploded on msg 2');
      (mockUseCase.execute as any)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(undefined);

      const messages: WAMessage[] = [
        {
          key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'batch-1' },
          message: { conversation: 'First' },
        },
        {
          key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'batch-2' },
          message: { conversation: 'Second' },
        },
        {
          key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'batch-3' },
          message: { conversation: 'Third' },
        },
      ];

      await adapter.handleMessages(messages);

      expect(mockUseCase.execute).toHaveBeenCalledTimes(3);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unhandled error processing incoming message',
        error,
        { messageId: 'batch-2' }
      );
    });

    it('should resolve sender routing and user.pnJid when message comes with @lid and remoteJidAlt @s.whatsapp.net', async () => {
      const lidMessage: WAMessage = {
        key: {
          remoteJid: '123456789012345@lid',
          remoteJidAlt: '919876543210@s.whatsapp.net',
          fromMe: false,
          id: 'msg-lid-pn',
        } as any,
        message: { conversation: 'Hello from LID user' },
        messageTimestamp: 1727223000,
      };

      (mockAccessControl.authenticate as any).mockResolvedValue({
        phoneNumber: '919876543210',
        pnJid: '919876543210@s.whatsapp.net',
        lidJid: '123456789012345@lid',
        name: 'Authorized User',
        role: 'user',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await adapter.handleMessages([lidMessage]);

      expect(mockLogger.debug).toHaveBeenCalledWith('Resolved sender routing', {
        remoteJid: '123456789012345@lid',
        remoteJidAlt: '919876543210@s.whatsapp.net',
        lookupAddress: '919876543210@s.whatsapp.net',
        companionLidJid: '123456789012345@lid',
      });
      expect(mockAccessControl.authenticate).toHaveBeenCalledWith(
        '919876543210@s.whatsapp.net',
        '123456789012345@lid'
      );
      expect(mockUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-lid-pn',
          userId: '919876543210@s.whatsapp.net',
          content: 'Hello from LID user',
        })
      );
    });

    it('should ignore non-PN remoteJidAlt and query access control with remoteJid and null companion', async () => {
      const lidMessageWithMalformedAlt: WAMessage = {
        key: {
          remoteJid: '123456789012345@lid',
          remoteJidAlt: 'not-a-pn-user',
          fromMe: false,
          id: 'msg-lid-bad-alt',
        } as any,
        message: { conversation: 'Hello with bad alt' },
        messageTimestamp: 1727223000,
      };

      (mockAccessControl.authenticate as any).mockResolvedValue({
        phoneNumber: '919876543210',
        pnJid: '919876543210@s.whatsapp.net',
        lidJid: '123456789012345@lid',
        name: 'Authorized User',
        role: 'user',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await adapter.handleMessages([lidMessageWithMalformedAlt]);

      expect(mockAccessControl.authenticate).toHaveBeenCalledWith(
        '123456789012345@lid',
        null
      );
      expect(mockUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-lid-bad-alt',
          userId: '919876543210@s.whatsapp.net',
        })
      );
    });

    it('should authenticate user and use user.pnJid when message comes with @lid and no remoteJidAlt', async () => {
      const lidMessage: WAMessage = {
        key: {
          remoteJid: '123456789012345@lid',
          fromMe: false,
          id: 'msg-lid-db',
        },
        message: { conversation: 'Hello from known LID user' },
        messageTimestamp: 1727223000,
      };

      (mockAccessControl.authenticate as any).mockResolvedValue({
        phoneNumber: '919876543210',
        pnJid: '919876543210@s.whatsapp.net',
        lidJid: '123456789012345@lid',
        name: 'Authorized User',
        role: 'user',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await adapter.handleMessages([lidMessage]);

      expect(mockAccessControl.authenticate).toHaveBeenCalledWith(
        '123456789012345@lid',
        null
      );
      expect(mockUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-lid-db',
          userId: '919876543210@s.whatsapp.net',
          content: 'Hello from known LID user',
        })
      );
    });

    it('should route phone number JID and use user.pnJid', async () => {
      const pnMessage: WAMessage = {
        key: {
          remoteJid: '919876543210:2@s.whatsapp.net',
          fromMe: false,
          id: 'msg-pn-device',
        },
        message: { conversation: 'Hello from multi-device' },
        messageTimestamp: 1727223000,
      };

      (mockAccessControl.authenticate as any).mockResolvedValue({
        phoneNumber: '919876543210',
        pnJid: '919876543210@s.whatsapp.net',
        lidJid: null,
        name: 'Authorized User',
        role: 'user',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await adapter.handleMessages([pnMessage]);

      expect(mockAccessControl.authenticate).toHaveBeenCalledWith(
        '919876543210:2@s.whatsapp.net',
        null
      );
      expect(mockUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-pn-device',
          userId: '919876543210@s.whatsapp.net',
          content: 'Hello from multi-device',
        })
      );
    });

    it('should catch authentication error for a message and continue processing subsequent messages', async () => {
      const failingMessage: WAMessage = {
        key: {
          remoteJid: '919999999999@s.whatsapp.net',
          fromMe: false,
          id: 'msg-failing',
        },
        message: { conversation: 'Message that triggers db error' },
        messageTimestamp: 1727223000,
      };

      const succeedingMessage: WAMessage = {
        key: {
          remoteJid: '919876543210@s.whatsapp.net',
          fromMe: false,
          id: 'msg-succeeding',
        },
        message: { conversation: 'Valid message following failure' },
        messageTimestamp: 1727223001,
      };

      const dbError = new Error('Database connection timeout');
      (mockAccessControl.authenticate as any).mockImplementation(async (address: string) => {
        if (address.includes('919999999999')) {
          throw dbError;
        }
        return {
          phoneNumber: '919876543210',
          pnJid: '919876543210@s.whatsapp.net',
          lidJid: null,
          name: 'Authorized User',
          role: 'user',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      });

      await adapter.handleMessages([failingMessage, succeedingMessage]);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to authenticate sender',
        dbError,
        expect.objectContaining({
          lookupAddress: '919999999999@s.whatsapp.net',
          remoteJid: '919999999999@s.whatsapp.net',
        })
      );

      expect(mockUseCase.execute).toHaveBeenCalledTimes(1);
      expect(mockUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-succeeding',
          userId: '919876543210@s.whatsapp.net',
          content: 'Valid message following failure',
        })
      );
    });
  });
});
