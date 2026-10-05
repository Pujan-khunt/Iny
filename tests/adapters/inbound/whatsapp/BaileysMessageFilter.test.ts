import { describe, it, expect } from 'vitest';
import { proto } from '@whiskeysockets/baileys';
import { BaileysMessageFilter } from '../../../../src/adapters/inbound/whatsapp/BaileysMessageFilter';

describe('BaileysMessageFilter', () => {
  const filter = new BaileysMessageFilter();

  it('should reject null or undefined payloads', () => {
    expect(filter.evaluate(null)).toEqual({ eligible: false, reason: 'missing_key' });
    expect(filter.evaluate(undefined)).toEqual({ eligible: false, reason: 'missing_key' });
  });

  it('should reject messages without key', () => {
    const raw = {} as proto.IWebMessageInfo;
    expect(filter.evaluate(raw)).toEqual({ eligible: false, reason: 'missing_key' });
  });

  it('should reject messages sent by the bot (fromMe === true)', () => {
    const raw: proto.IWebMessageInfo = {
      key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: true, id: 'm1' },
      message: { conversation: 'Hello' },
    };
    expect(filter.evaluate(raw)).toEqual({ eligible: false, reason: 'from_me' });
  });

  it('should reject messages without remoteJid', () => {
    const raw: proto.IWebMessageInfo = {
      key: { fromMe: false, id: 'm2' },
      message: { conversation: 'Hello' },
    };
    expect(filter.evaluate(raw)).toEqual({ eligible: false, reason: 'missing_address' });
  });

  it('should reject messages without id', () => {
    const raw: proto.IWebMessageInfo = {
      key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false },
      message: { conversation: 'Hello' },
    };
    expect(filter.evaluate(raw)).toEqual({ eligible: false, reason: 'missing_address' });
  });

  it('should reject group messages (@g.us)', () => {
    const raw: proto.IWebMessageInfo = {
      key: { remoteJid: '123456789-987654@g.us', fromMe: false, id: 'm3' },
      message: { conversation: 'Group text' },
    };
    expect(filter.evaluate(raw)).toEqual({ eligible: false, reason: 'group_or_broadcast' });
  });

  it('should reject status broadcast messages', () => {
    const raw1: proto.IWebMessageInfo = {
      key: { remoteJid: 'status@broadcast', fromMe: false, id: 'm4' },
      message: { conversation: 'Status update' },
    };
    const raw2: proto.IWebMessageInfo = {
      key: { remoteJid: '12345@broadcast', fromMe: false, id: 'm5' },
      message: { conversation: 'Broadcast update' },
    };
    expect(filter.evaluate(raw1)).toEqual({ eligible: false, reason: 'group_or_broadcast' });
    expect(filter.evaluate(raw2)).toEqual({ eligible: false, reason: 'group_or_broadcast' });
  });

  it('should reject messages with empty or missing message payload', () => {
    const raw1: proto.IWebMessageInfo = {
      key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'm6' },
    };
    const raw2: proto.IWebMessageInfo = {
      key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'm7' },
      message: null,
    };
    expect(filter.evaluate(raw1)).toEqual({ eligible: false, reason: 'non_text' });
    expect(filter.evaluate(raw2)).toEqual({ eligible: false, reason: 'non_text' });
  });

  it('should reject non-text messages (e.g. image, reaction, audio without text)', () => {
    const raw: proto.IWebMessageInfo = {
      key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'm8' },
      message: { imageMessage: { caption: '' } },
    };
    expect(filter.evaluate(raw)).toEqual({ eligible: false, reason: 'non_text' });
  });

  it('should reject messages with empty or whitespace-only text', () => {
    const raw1: proto.IWebMessageInfo = {
      key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'm9' },
      message: { conversation: '   ' },
    };
    const raw2: proto.IWebMessageInfo = {
      key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'm10' },
      message: { extendedTextMessage: { text: '  \n  ' } },
    };
    expect(filter.evaluate(raw1)).toEqual({ eligible: false, reason: 'non_text' });
    expect(filter.evaluate(raw2)).toEqual({ eligible: false, reason: 'non_text' });
  });

  it('should accept valid 1-on-1 direct message with standard conversation text', () => {
    const raw: proto.IWebMessageInfo = {
      key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'm11' },
      message: { conversation: 'Hello Iny!' },
    };
    expect(filter.evaluate(raw)).toEqual({ eligible: true, message: raw });
  });

  it('should accept valid 1-on-1 direct message with extendedTextMessage text', () => {
    const raw: proto.IWebMessageInfo = {
      key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'm12' },
      message: { extendedTextMessage: { text: 'Calculate 5 + 5' } },
    };
    expect(filter.evaluate(raw)).toEqual({ eligible: true, message: raw });
  });

  it('should accept wrapped ephemeral messages (disappearing messages)', () => {
    const raw: proto.IWebMessageInfo = {
      key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'm-eph' },
      message: {
        ephemeralMessage: {
          message: { conversation: 'Hello from disappearing message' },
        },
      },
    };
    expect(filter.evaluate(raw)).toEqual({ eligible: true, message: raw });
  });

  it('should accept wrapped viewOnce messages with text content', () => {
    const raw: proto.IWebMessageInfo = {
      key: { remoteJid: '919876543210@s.whatsapp.net', fromMe: false, id: 'm-vo' },
      message: {
        viewOnceMessage: {
          message: { extendedTextMessage: { text: 'View once text' } },
        },
      },
    };
    expect(filter.evaluate(raw)).toEqual({ eligible: true, message: raw });
  });
});
