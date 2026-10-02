import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaileysMessageSenderAdapter } from '../../../../src/adapters/outbound/whatsapp/BaileysMessageSenderAdapter';
import { BaileysConnectionManager } from '../../../../src/adapters/outbound/whatsapp/BaileysConnectionManager';
import { LoggerPort } from '../../../../src/core/ports/LoggerPort';

describe('BaileysMessageSenderAdapter', () => {
  let mockLogger: LoggerPort;
  let mockSocket: { sendMessage: ReturnType<typeof vi.fn> };
  let mockConnManager: BaileysConnectionManager;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    mockSocket = {
      sendMessage: vi.fn().mockResolvedValue({}),
    };
    mockConnManager = {
      getSocket: vi.fn().mockReturnValue(mockSocket),
    } as unknown as BaileysConnectionManager;
  });

  it('should deliver text message via active socket', async () => {
    const sender = new BaileysMessageSenderAdapter(mockConnManager, mockLogger);

    await sender.sendMessage('919876543210@s.whatsapp.net', 'Hello user');

    expect(mockSocket.sendMessage).toHaveBeenCalledWith('919876543210@s.whatsapp.net', {
      text: 'Hello user',
    });
  });

  it('should throw an error when WhatsApp socket is not connected', async () => {
    (mockConnManager.getSocket as any).mockReturnValue(null);

    const sender = new BaileysMessageSenderAdapter(mockConnManager, mockLogger);

    await expect(sender.sendMessage('919876543210@s.whatsapp.net', 'Hello')).rejects.toThrow(
      'WhatsApp socket is not connected'
    );
    expect(mockSocket.sendMessage).not.toHaveBeenCalled();
  });

  it('should log error and rethrow when socket.sendMessage fails', async () => {
    const sendError = new Error('Transport write failure');
    mockSocket.sendMessage.mockRejectedValue(sendError);

    const sender = new BaileysMessageSenderAdapter(mockConnManager, mockLogger);

    await expect(sender.sendMessage('919876543210@s.whatsapp.net', 'Hello Iny')).rejects.toThrow(
      'Transport write failure'
    );
    expect(mockLogger.error).toHaveBeenCalledWith('Failed to send WhatsApp message', sendError, {
      recipientJid: '919876543210@s.whatsapp.net',
    });
  });
});
