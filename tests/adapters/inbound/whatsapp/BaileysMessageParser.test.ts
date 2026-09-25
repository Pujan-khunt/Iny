import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { proto } from '@whiskeysockets/baileys';
import { BaileysMessageParser } from '../../../../src/adapters/inbound/whatsapp/BaileysMessageParser';

describe('BaileysMessageParser', () => {
  const parser = new BaileysMessageParser();

  it('should ignore messages sent by the bot itself (fromMe === true)', () => {
    const raw: proto.IWebMessageInfo = {
      key: {
        remoteJid: '919876543210@s.whatsapp.net',
        fromMe: true,
        id: 'msg-1',
      },
      message: { conversation: 'Hello bot' },
    };

    expect(parser.parse(raw)).toBeNull();
  });

  it('should ignore messages from groups (@g.us)', () => {
    const raw: proto.IWebMessageInfo = {
      key: {
        remoteJid: '123456789-987654@g.us',
        fromMe: false,
        id: 'msg-2',
      },
      message: { conversation: 'Group text' },
    };

    expect(parser.parse(raw)).toBeNull();
  });

  it('should ignore status broadcast messages', () => {
    const raw: proto.IWebMessageInfo = {
      key: {
        remoteJid: 'status@broadcast',
        fromMe: false,
        id: 'msg-3',
      },
      message: { conversation: 'Status update' },
    };

    expect(parser.parse(raw)).toBeNull();
  });

  it('should ignore broadcast messages ending in @broadcast', () => {
    const raw: proto.IWebMessageInfo = {
      key: {
        remoteJid: '123456789@broadcast',
        fromMe: false,
        id: 'msg-broadcast',
      },
      message: { conversation: 'Broadcast channel message' },
    };

    expect(parser.parse(raw)).toBeNull();
  });

  it('should ignore messages without message property or text content (e.g. image or reaction)', () => {
    const rawNoMessage: proto.IWebMessageInfo = {
      key: {
        remoteJid: '919876543210@s.whatsapp.net',
        fromMe: false,
        id: 'msg-no-message',
      },
      message: null,
    };
    expect(parser.parse(rawNoMessage)).toBeNull();

    const raw: proto.IWebMessageInfo = {
      key: {
        remoteJid: '919876543210@s.whatsapp.net',
        fromMe: false,
        id: 'msg-4',
      },
      message: {
        imageMessage: { caption: '' },
      },
    };

    expect(parser.parse(raw)).toBeNull();
  });

  it('should ignore messages with empty or whitespace-only text', () => {
    const raw: proto.IWebMessageInfo = {
      key: {
        remoteJid: '919876543210@s.whatsapp.net',
        fromMe: false,
        id: 'msg-whitespace',
      },
      message: { conversation: '   \n  \t ' },
    };

    expect(parser.parse(raw)).toBeNull();
  });

  it('should ignore messages with missing key or missing remoteJid', () => {
    const rawNoKey: proto.IWebMessageInfo = {
      message: { conversation: 'Hello' },
    };
    expect(parser.parse(rawNoKey)).toBeNull();

    const rawNoJid: proto.IWebMessageInfo = {
      key: {
        fromMe: false,
        id: 'msg-no-jid',
      },
      message: { conversation: 'Hello' },
    };
    expect(parser.parse(rawNoJid)).toBeNull();
  });

  it('should correctly parse standard conversation text into a UserMessage', () => {
    const raw: proto.IWebMessageInfo = {
      key: {
        remoteJid: '919876543210@s.whatsapp.net',
        fromMe: false,
        id: 'msg-5',
      },
      message: { conversation: 'Hello Iny!' },
      messageTimestamp: 1727222400,
    };

    const parsed = parser.parse(raw);
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual({
      id: 'msg-5',
      userId: '919876543210@s.whatsapp.net',
      role: 'user',
      content: 'Hello Iny!',
      timestamp: new Date(1727222400 * 1000),
    });
  });

  it('should correctly parse extendedTextMessage (e.g. quoted text message)', () => {
    const raw: proto.IWebMessageInfo = {
      key: {
        remoteJid: '919876543210@s.whatsapp.net',
        fromMe: false,
        id: 'msg-6',
      },
      message: {
        extendedTextMessage: { text: 'Calculate 25 * 4' },
      },
      messageTimestamp: 1727222450,
    };

    const parsed = parser.parse(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.role).toBe('user');
    expect(parsed?.content).toBe('Calculate 25 * 4');
    expect(parsed?.userId).toBe('919876543210@s.whatsapp.net');
    expect(parsed?.timestamp).toEqual(new Date(1727222450 * 1000));
  });

  it('should generate a fallback UUID if raw message id is missing', () => {
    const raw: proto.IWebMessageInfo = {
      key: {
        remoteJid: '919876543210@s.whatsapp.net',
        fromMe: false,
      },
      message: { conversation: 'Hello' },
    };

    const parsed = parser.parse(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBeDefined();
    expect(parsed?.id.length).toBeGreaterThan(0);
    expect(parsed?.role).toBe('user');
  });

  it('should correctly parse Long or object-like messageTimestamp', () => {
    const rawWithLow: proto.IWebMessageInfo = {
      key: {
        remoteJid: '919876543210@s.whatsapp.net',
        fromMe: false,
        id: 'msg-long-1',
      },
      message: { conversation: 'Hello Long low' },
      messageTimestamp: { low: 1727222400, high: 0, unsigned: false } as any,
    };

    const parsedLow = parser.parse(rawWithLow);
    expect(parsedLow?.timestamp).toEqual(new Date(1727222400 * 1000));

    const rawWithToNumber: proto.IWebMessageInfo = {
      key: {
        remoteJid: '919876543210@s.whatsapp.net',
        fromMe: false,
        id: 'msg-long-2',
      },
      message: { conversation: 'Hello Long toNumber' },
      messageTimestamp: { toNumber: () => 1727222450 } as any,
    };

    const parsedToNumber = parser.parse(rawWithToNumber);
    expect(parsedToNumber?.timestamp).toEqual(new Date(1727222450 * 1000));
  });

  describe('timestamp fallback', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(1727223000 * 1000));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should fallback to current time if messageTimestamp is missing, null, or non-positive', () => {
      const raw: proto.IWebMessageInfo = {
        key: {
          remoteJid: '919876543210@s.whatsapp.net',
          fromMe: false,
          id: 'msg-no-timestamp',
        },
        message: { conversation: 'No timestamp' },
        messageTimestamp: null,
      };

      const parsed = parser.parse(raw);
      expect(parsed).not.toBeNull();
      expect(parsed?.timestamp).toEqual(new Date(1727223000 * 1000));

      const rawZero: proto.IWebMessageInfo = {
        key: {
          remoteJid: '919876543210@s.whatsapp.net',
          fromMe: false,
          id: 'msg-zero-timestamp',
        },
        message: { conversation: 'Zero timestamp' },
        messageTimestamp: 0,
      };
      const parsedZero = parser.parse(rawZero);
      expect(parsedZero?.timestamp).toEqual(new Date(1727223000 * 1000));
    });
  });
});
