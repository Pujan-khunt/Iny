import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaileysMessageSenderAdapter } from '../../../../src/adapters/outbound/whatsapp/BaileysMessageSenderAdapter';
import { AllowlistPort } from '../../../../src/adapters/outbound/access-control/AllowlistPort';
import { BaileysConnectionManager } from '../../../../src/adapters/outbound/whatsapp/BaileysConnectionManager';
import { LoggerPort } from '../../../../src/core/ports/LoggerPort';
import { WhatsAppJid } from '../../../../src/adapters/common/whatsapp/WhatsAppJid';

describe('BaileysMessageSenderAdapter', () => {
  let mockLogger: LoggerPort;
  let mockSocket: { sendMessage: ReturnType<typeof vi.fn> };
  let mockConnManager: BaileysConnectionManager;
  let mockAllowlist: AllowlistPort;

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
    mockAllowlist = {
      authenticate: vi.fn().mockResolvedValue({
        phoneNumber: '919876543210',
        jid: '919876543210@s.whatsapp.net',
        lid: null,
        name: null,
        role: 'user',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      isAllowed: vi.fn().mockImplementation(async (address: string) => {
        const normalized = WhatsAppJid.normalize(address);
        return normalized === '919876543210@s.whatsapp.net';
      }),
      getUser: vi.fn().mockResolvedValue(null),
      seedUsers: vi.fn().mockResolvedValue(undefined),
      countActiveUsers: vi.fn().mockResolvedValue(1),
      cacheLid: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('should deliver text message via active socket when recipient is permitted by allowlist', async () => {
    const sender = new BaileysMessageSenderAdapter(mockConnManager, mockAllowlist, mockLogger);

    await sender.sendMessage('919876543210@s.whatsapp.net', 'Hello user');

    expect(mockSocket.sendMessage).toHaveBeenCalledWith('919876543210@s.whatsapp.net', {
      text: 'Hello user',
    });
  });

  it('should deliver text message when recipient is provided as raw phone number in allowlist', async () => {
    const sender = new BaileysMessageSenderAdapter(mockConnManager, mockAllowlist, mockLogger);

    await sender.sendMessage('+91 (987) 654-3210', 'Hello user');

    expect(mockSocket.sendMessage).toHaveBeenCalledWith('+91 (987) 654-3210', {
      text: 'Hello user',
    });
  });

  it('should drop message and log warning when recipient is not in allowlist (defense-in-depth)', async () => {
    const sender = new BaileysMessageSenderAdapter(mockConnManager, mockAllowlist, mockLogger);

    await sender.sendMessage('919999888877@s.whatsapp.net', 'Blocked message');

    expect(mockSocket.sendMessage).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Blocked outbound message to unauthorized recipient (defense-in-depth)',
      undefined,
      { userId: '919999888877@s.whatsapp.net' }
    );
  });

  it('should drop message and log warning when recipient is a group jid', async () => {
    const sender = new BaileysMessageSenderAdapter(mockConnManager, mockAllowlist, mockLogger);

    await sender.sendMessage('123456789-987654@g.us', 'Group announcement');

    expect(mockSocket.sendMessage).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Blocked outbound message to unauthorized recipient (defense-in-depth)',
      undefined,
      { userId: '123456789-987654@g.us' }
    );
  });

  it('should throw an error when WhatsApp socket is not connected', async () => {
    (mockConnManager.getSocket as any).mockReturnValue(null);

    const sender = new BaileysMessageSenderAdapter(mockConnManager, mockAllowlist, mockLogger);

    await expect(sender.sendMessage('919876543210@s.whatsapp.net', 'Hello')).rejects.toThrow(
      'WhatsApp socket is not connected'
    );
    expect(mockSocket.sendMessage).not.toHaveBeenCalled();
  });

  it('should log error and rethrow when socket.sendMessage fails', async () => {
    const sendError = new Error('Transport write failure');
    mockSocket.sendMessage.mockRejectedValue(sendError);

    const sender = new BaileysMessageSenderAdapter(mockConnManager, mockAllowlist, mockLogger);

    await expect(sender.sendMessage('919876543210@s.whatsapp.net', 'Hello Iny')).rejects.toThrow(
      'Transport write failure'
    );
    expect(mockLogger.error).toHaveBeenCalledWith('Failed to send WhatsApp message', sendError, {
      recipientJid: '919876543210@s.whatsapp.net',
    });
  });
});
