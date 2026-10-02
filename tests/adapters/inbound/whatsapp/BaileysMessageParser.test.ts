import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { proto } from '@whiskeysockets/baileys';
import { BaileysMessageParser } from '../../../../src/adapters/inbound/whatsapp/BaileysMessageParser';
import { EligibleWebMessageInfo } from '../../../../src/adapters/inbound/whatsapp/BaileysMessageFilter';

describe('BaileysMessageParser', () => {
  const parser = new BaileysMessageParser();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should correctly parse standard conversation text into a UserMessage', () => {
    const raw: proto.IWebMessageInfo = {
      key: {
        remoteJid: '919876543210@s.whatsapp.net',
        fromMe: false,
        id: 'msg-1',
      },
      message: { conversation: 'Hello Iny!' },
      messageTimestamp: 1727222400,
    };

    const parsed = parser.parse(raw, '919876543210@s.whatsapp.net');
    expect(parsed).toEqual({
      id: 'msg-1',
      userId: '919876543210@s.whatsapp.net',
      content: 'Hello Iny!',
      timestamp: new Date(1727222400 * 1000),
      role: 'user',
    });
  });

  it('should correctly parse extendedTextMessage (e.g. quoted text message)', () => {
    const raw: proto.IWebMessageInfo = {
      key: {
        remoteJid: '919876543210@s.whatsapp.net',
        fromMe: false,
        id: 'msg-2',
      },
      message: {
        extendedTextMessage: { text: 'Calculate 25 * 4' },
      },
      messageTimestamp: 1727222450,
    };

    const parsed = parser.parse(raw, '919876543210@s.whatsapp.net');
    expect(parsed).toEqual({
      id: 'msg-2',
      userId: '919876543210@s.whatsapp.net',
      content: 'Calculate 25 * 4',
      timestamp: new Date(1727222450 * 1000),
      role: 'user',
    });
  });

  it('should correctly handle protobuf Long timestamp with .low property', () => {
    const raw: proto.IWebMessageInfo = {
      key: {
        remoteJid: '919876543210@s.whatsapp.net',
        fromMe: false,
        id: 'msg-3',
      },
      message: { conversation: 'Long low timestamp test' },
      messageTimestamp: { low: 1727222500, high: 0, unsigned: true } as any,
    };

    const parsed = parser.parse(raw, '919876543210@s.whatsapp.net');
    expect(parsed.timestamp).toEqual(new Date(1727222500 * 1000));
  });

  it('should correctly handle protobuf Long timestamp with .toNumber() method', () => {
    const raw: proto.IWebMessageInfo = {
      key: {
        remoteJid: '919876543210@s.whatsapp.net',
        fromMe: false,
        id: 'msg-4',
      },
      message: { conversation: 'Long toNumber timestamp test' },
      messageTimestamp: { toNumber: () => 1727222600 } as any,
    };

    const parsed = parser.parse(raw, '919876543210@s.whatsapp.net');
    expect(parsed.timestamp).toEqual(new Date(1727222600 * 1000));
  });

  it('should fallback to current time when timestamp is missing or non-positive', () => {
    const raw: EligibleWebMessageInfo = {
      key: {
        remoteJid: '919876543210@s.whatsapp.net',
        fromMe: false,
        id: 'msg-5',
      },
      message: { conversation: 'Missing timestamp test' },
    };

    const parsed = parser.parse(raw, '919876543210@s.whatsapp.net');
    expect(parsed.timestamp).toEqual(new Date('2026-09-25T12:00:00.000Z'));
  });

  it('should bind canonicalUserId to UserMessage.userId regardless of raw remoteJid', () => {
    const raw: EligibleWebMessageInfo = {
      key: {
        remoteJid: '123456789012345@lid',
        fromMe: false,
        id: 'msg-lid-1',
      },
      message: { conversation: 'Message from LID user' },
      messageTimestamp: 1727222400,
    };

    const parsed = parser.parse(raw, '919876543210@s.whatsapp.net');
    expect(parsed).toEqual({
      id: 'msg-lid-1',
      userId: '919876543210@s.whatsapp.net',
      content: 'Message from LID user',
      timestamp: new Date(1727222400 * 1000),
      role: 'user',
    });
  });

  it('should correctly parse text from wrapped ephemeral messages (disappearing messages)', () => {
    const raw: proto.IWebMessageInfo = {
      key: {
        remoteJid: '919876543210@s.whatsapp.net',
        fromMe: false,
        id: 'msg-eph',
      },
      message: {
        ephemeralMessage: {
          message: { conversation: 'Secret disappearing message' },
        },
      },
      messageTimestamp: 1727222400,
    };

    const parsed = parser.parse(raw as EligibleWebMessageInfo, '919876543210@s.whatsapp.net');
    expect(parsed.content).toBe('Secret disappearing message');
  });

  it('should correctly parse text from wrapped viewOnce messages', () => {
    const raw: proto.IWebMessageInfo = {
      key: {
        remoteJid: '919876543210@s.whatsapp.net',
        fromMe: false,
        id: 'msg-vo',
      },
      message: {
        viewOnceMessage: {
          message: { extendedTextMessage: { text: 'View once payload' } },
        },
      },
      messageTimestamp: 1727222400,
    };

    const parsed = parser.parse(raw as EligibleWebMessageInfo, '919876543210@s.whatsapp.net');
    expect(parsed.content).toBe('View once payload');
  });
});
