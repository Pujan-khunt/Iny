import { describe, it, expect, vi, beforeEach } from 'vitest';
import { proto } from '@whiskeysockets/baileys';
import { WhatsAppInboundAdapter } from '../../../../src/adapters/inbound/whatsapp/WhatsAppInboundAdapter';
import { WhatsAppAllowlist } from '../../../../src/adapters/common/access-control/WhatsAppAllowlist';
import { BaileysMessageParser } from '../../../../src/adapters/inbound/whatsapp/BaileysMessageParser';
import { ProcessIncomingMessage } from '../../../../src/core/use-cases/ProcessIncomingMessage';
import { BaileysConnectionManager } from '../../../../src/adapters/outbound/whatsapp/BaileysConnectionManager';
import { LoggerPort } from '../../../../src/core/ports/LoggerPort';

describe('WhatsAppInboundAdapter', () => {
  let mockLogger: LoggerPort;
  let mockUseCase: ProcessIncomingMessage;
  let mockConnManager: BaileysConnectionManager;
  let allowlist: WhatsAppAllowlist;
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
    allowlist = new WhatsAppAllowlist(['919876543210']);
    parser = new BaileysMessageParser();
    adapter = new WhatsAppInboundAdapter(
      mockUseCase,
      mockConnManager,
      allowlist,
      parser,
      mockLogger
    );
  });

  describe('start', () => {
    it('should register message upsert callback on connection manager and log info', () => {
      adapter.start();

      expect(mockConnManager.onIncomingMessages).toHaveBeenCalledWith(expect.any(Function));
      expect(mockLogger.info).toHaveBeenCalledWith(
        'WhatsApp inbound adapter listening for incoming messages'
      );
    });

    it('should handle incoming messages when registered message upsert callback is fired', async () => {
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

    it('should skip messages without a remoteJid', async () => {
      const msgWithoutJid: proto.IWebMessageInfo = {
        key: { fromMe: false, id: 'no-jid' },
        message: { conversation: 'Where am I from?' },
      };

      await adapter.handleMessages([msgWithoutJid]);

      expect(mockUseCase.execute).not.toHaveBeenCalled();
      expect(mockLogger.debug).not.toHaveBeenCalled();
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
        { senderJid: '919999888877@s.whatsapp.net' }
      );
    });

    it('should ignore messages that fail parsing (e.g. non-text, fromMe, or groups) without calling use case', async () => {
      const nonTextMessage: proto.IWebMessageInfo = {
        key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'm2' },
        message: { imageMessage: { caption: '' } },
      };

      await adapter.handleMessages([nonTextMessage]);

      expect(mockUseCase.execute).not.toHaveBeenCalled();
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
  });
});
