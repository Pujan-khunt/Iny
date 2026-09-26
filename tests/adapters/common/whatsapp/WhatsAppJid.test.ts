import { describe, it, expect } from 'vitest';
import { WhatsAppJid } from '../../../../src/adapters/common/whatsapp/WhatsAppJid';

describe('WhatsAppJid', () => {
  describe('normalize', () => {
    it('normalizes a standard digit-only phone number to s.whatsapp.net JID', () => {
      expect(WhatsAppJid.normalize('919876543210')).toBe('919876543210@s.whatsapp.net');
    });

    it('normalizes formatted phone number with spaces, hyphens, and plus signs', () => {
      expect(WhatsAppJid.normalize('+91 (987) 654-3210')).toBe('919876543210@s.whatsapp.net');
    });

    it('normalizes already valid s.whatsapp.net JIDs', () => {
      expect(WhatsAppJid.normalize('  919876543210@s.whatsapp.net  ')).toBe('919876543210@s.whatsapp.net');
      expect(WhatsAppJid.normalize('919876543210@S.WHATSAPP.NET')).toBe('919876543210@s.whatsapp.net');
    });

    it('returns null for other domain addresses including groups and broadcasts', () => {
      expect(WhatsAppJid.normalize('123456789-987654@g.us')).toBeNull();
      expect(WhatsAppJid.normalize('status@broadcast')).toBeNull();
      expect(WhatsAppJid.normalize('newsletter@broadcast')).toBeNull();
      expect(WhatsAppJid.normalize('user@c.us')).toBeNull();
      expect(WhatsAppJid.normalize('someone@example.com')).toBeNull();
    });

    it('returns null for empty or whitespace-only inputs', () => {
      expect(WhatsAppJid.normalize('')).toBeNull();
      expect(WhatsAppJid.normalize('   ')).toBeNull();
    });

    it('returns null for s.whatsapp.net JIDs containing non-digit user portions', () => {
      expect(WhatsAppJid.normalize('invalid@s.whatsapp.net')).toBeNull();
      expect(WhatsAppJid.normalize('user123@s.whatsapp.net')).toBeNull();
    });

    it('returns null for strings without any digits', () => {
      expect(WhatsAppJid.normalize('not-a-number')).toBeNull();
      expect(WhatsAppJid.normalize('+++---()')).toBeNull();
    });
  });

  describe('isGroup', () => {
    it('returns true for JIDs ending in @g.us', () => {
      expect(WhatsAppJid.isGroup('123456789-987654@g.us')).toBe(true);
      expect(WhatsAppJid.isGroup('  123456789@g.us  ')).toBe(true);
    });

    it('returns false for non-group JIDs', () => {
      expect(WhatsAppJid.isGroup('919876543210@s.whatsapp.net')).toBe(false);
      expect(WhatsAppJid.isGroup('status@broadcast')).toBe(false);
      expect(WhatsAppJid.isGroup('')).toBe(false);
    });
  });

  describe('isBroadcast', () => {
    it('returns true for status@broadcast and generic @broadcast JIDs', () => {
      expect(WhatsAppJid.isBroadcast('status@broadcast')).toBe(true);
      expect(WhatsAppJid.isBroadcast('updates@broadcast')).toBe(true);
    });

    it('returns false for non-broadcast JIDs', () => {
      expect(WhatsAppJid.isBroadcast('919876543210@s.whatsapp.net')).toBe(false);
      expect(WhatsAppJid.isBroadcast('123456789@g.us')).toBe(false);
      expect(WhatsAppJid.isBroadcast('')).toBe(false);
    });
  });

  describe('isUser', () => {
    it('returns true for valid numeric s.whatsapp.net JIDs', () => {
      expect(WhatsAppJid.isUser('919876543210@s.whatsapp.net')).toBe(true);
      expect(WhatsAppJid.isUser('  919876543210@S.WHATSAPP.NET  ')).toBe(true);
    });

    it('returns false for non-numeric or non-user JIDs', () => {
      expect(WhatsAppJid.isUser('invalid@s.whatsapp.net')).toBe(false);
      expect(WhatsAppJid.isUser('123456789@g.us')).toBe(false);
      expect(WhatsAppJid.isUser('status@broadcast')).toBe(false);
      expect(WhatsAppJid.isUser('919876543210')).toBe(false);
    });
  });
});
