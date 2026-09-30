import { describe, it, expect, vi, beforeEach } from 'vitest';
import { proto } from '@whiskeysockets/baileys';
import { WhatsAppInboundAdapter } from '../../../../src/adapters/inbound/whatsapp/WhatsAppInboundAdapter';
import { AllowlistPort } from '../../../../src/adapters/outbound/access-control/AllowlistPort';
import { BaileysMessageFilter } from '../../../../src/adapters/inbound/whatsapp/BaileysMessageFilter';
import { BaileysMessageParser } from '../../../../src/adapters/inbound/whatsapp/BaileysMessageParser';
import { ProcessIncomingMessage } from '../../../../src/core/use-cases/ProcessIncomingMessage';
import { BaileysConnectionManager } from '../../../../src/adapters/outbound/whatsapp/BaileysConnectionManager';
import { LoggerPort } from '../../../../src/core/ports/LoggerPort';

describe('WhatsAppInboundAdapter', () => {
  let mockLogger: LoggerPort;
  let mockUseCase: ProcessIncomingMessage;
  let mockConnManager: BaileysConnectionManager;
  let mockAllowlist: AllowlistPort;
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
      onIncomingMessages: vi.fn(),
    } as unknown as BaileysConnectionManager;
    mockAllowlist = {
      isAllowed: vi.fn().mockImplementation(async (address: string) => {
        return address.includes('919876543210');
      }),
      getUser: vi.fn().mockResolvedValue(null),
      seedUsers: vi.fn().mockResolvedValue(undefined),
      countActiveUsers: vi.fn().mockResolvedValue(1),
      cacheLid: vi.fn().mockResolvedValue(undefined),
    };
    filter = new BaileysMessageFilter();
    parser = new BaileysMessageParser();
    adapter = new WhatsAppInboundAdapter(
      mockUseCase,
      mockConnManager,
      mockAllowlist,
      filter,
      parser,
      mockLogger
    );
  });

  describe('start', () => {
    it('should register incoming messages callback on connection manager and log info', () => {
      adapter.start();

      expect(mockConnManager.onIncomingMessages).toHaveBeenCalledWith(expect.any(Function));
      expect(mockLogger.info).toHaveBeenCalledWith(
        'WhatsApp inbound adapter listening for incoming messages'
      );
    });

    it('should handle incoming messages when registered incoming messages callback is fired', async () => {
      let registeredCallback: ((messages: proto.IWebMessageInfo[]) => Promise<void>) | null = null;
      (mockConnManager.onIncomingMessages as any).mockImplementation((cb: any) => {
        registeredCallback = cb;
      });

      adapter.start();
      expect(registeredCallback).not.toBeNull();

      const validMessage: proto.IWebMessageInfo = {
        key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'm-cb-1' },
        message: { conversation: 'Hello through callback' },
        messageTimestamp: 1727223000,
      };

      await registeredCallback!([validMessage]);

      expect(mockUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'm-cb-1',
          userId: '919876543210@s.whatsapp.net',
          content: 'Hello through callback',
        })
      );
    });
  });

  describe('handleMessages', () => {
    it('should handle empty messages array safely without invoking use case', async () => {
      await adapter.handleMessages([]);

      expect(mockUseCase.execute).not.toHaveBeenCalled();
    });

    it('should skip ineligible messages (e.g. fromMe === true)', async () => {
      const selfMsg: proto.IWebMessageInfo = {
        key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: true, id: 'self-1' },
        message: { conversation: 'I sent this' },
      };

      await adapter.handleMessages([selfMsg]);

      expect(mockUseCase.execute).not.toHaveBeenCalled();
    });

    it('should skip ineligible messages without text or from groups without calling use case', async () => {
      const nonTextMessage: proto.IWebMessageInfo = {
        key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'm2' },
        message: { imageMessage: { caption: '' } },
      };
      const groupMessage: proto.IWebMessageInfo = {
        key: { remoteJid: '123456789-987654@g.us', fromMe: false, id: 'm-grp' },
        message: { conversation: 'Group text' },
      };

      await adapter.handleMessages([nonTextMessage, groupMessage]);

      expect(mockUseCase.execute).not.toHaveBeenCalled();
    });

    it('should ignore incoming messages from unauthorized senders, log debug, and not call use case', async () => {
      const unauthorizedMessage: proto.IWebMessageInfo = {
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
      const validMessage: proto.IWebMessageInfo = {
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
        mockAllowlist,
        filter,
        badParser,
        mockLogger
      );

      const validLookingMsg: proto.IWebMessageInfo = {
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

      const validMessage: proto.IWebMessageInfo = {
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

      const messages: proto.IWebMessageInfo[] = [
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

    it('should resolve canonical PNJID when message comes with @lid and remoteJidAlt @s.whatsapp.net', async () => {
      const lidMessage: proto.IWebMessageInfo = {
        key: {
          remoteJid: '123456789012345@lid',
          remoteJidAlt: '919876543210@s.whatsapp.net',
          fromMe: false,
          id: 'msg-lid-pn',
        } as any,
        message: { conversation: 'Hello from LID user' },
        messageTimestamp: 1727223000,
      };

      (mockAllowlist.isAllowed as any).mockResolvedValue(true);

      await adapter.handleMessages([lidMessage]);

      expect(mockAllowlist.isAllowed).toHaveBeenCalledWith(
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

    it('should resolve canonical PNJID via allowlist.getUser when message comes with @lid and no remoteJidAlt', async () => {
      const lidMessage: proto.IWebMessageInfo = {
        key: {
          remoteJid: '123456789012345@lid',
          fromMe: false,
          id: 'msg-lid-db',
        },
        message: { conversation: 'Hello from known LID user' },
        messageTimestamp: 1727223000,
      };

      (mockAllowlist.isAllowed as any).mockResolvedValue(true);
      (mockAllowlist.getUser as any).mockResolvedValue({
        phoneNumber: '919876543210',
        jid: '919876543210@s.whatsapp.net',
        lid: '123456789012345@lid',
        name: 'Authorized User',
        role: 'user',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await adapter.handleMessages([lidMessage]);

      expect(mockAllowlist.isAllowed).toHaveBeenCalledWith(
        '123456789012345@lid',
        '123456789012345@lid'
      );
      expect(mockAllowlist.getUser).toHaveBeenCalledWith('123456789012345@lid');
      expect(mockUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-lid-db',
          userId: '919876543210@s.whatsapp.net',
          content: 'Hello from known LID user',
        })
      );
    });

    it('should drop message and log warning when canonical PNJID cannot be resolved', async () => {
      const unresolvableLidMessage: proto.IWebMessageInfo = {
        key: {
          remoteJid: '123456789012345@lid',
          fromMe: false,
          id: 'msg-unresolvable',
        },
        message: { conversation: 'Hello from unmapped LID' },
        messageTimestamp: 1727223000,
      };

      (mockAllowlist.isAllowed as any).mockResolvedValue(true);
      (mockAllowlist.getUser as any).mockResolvedValue(null);

      await adapter.handleMessages([unresolvableLidMessage]);

      expect(mockUseCase.execute).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Dropping message: unable to resolve canonical phone identity',
        { remoteJid: '123456789012345@lid', remoteJidAlt: undefined }
      );
    });

    it('should defensively normalize remoteJid for canonical PNJID when message arrives from phone number JID', async () => {
      const pnMessage: proto.IWebMessageInfo = {
        key: {
          remoteJid: '919876543210:2@s.whatsapp.net',
          fromMe: false,
          id: 'msg-pn-device',
        },
        message: { conversation: 'Hello from multi-device' },
        messageTimestamp: 1727223000,
      };

      (mockAllowlist.isAllowed as any).mockResolvedValue(true);

      await adapter.handleMessages([pnMessage]);

      expect(mockUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-pn-device',
          userId: '919876543210@s.whatsapp.net',
          content: 'Hello from multi-device',
        })
      );
    });
  });
});
