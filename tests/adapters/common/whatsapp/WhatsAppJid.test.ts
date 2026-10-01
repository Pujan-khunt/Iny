import { describe, it, expect } from 'vitest';
import { WhatsAppJid } from '../../../../src/adapters/common/whatsapp/WhatsAppJid';

describe('WhatsAppJid', () => {
  describe('normalize', () => {
    it('should normalize raw digit phone numbers to PNJID', () => {
      expect(WhatsAppJid.normalize('919876543210')).toBe('919876543210@s.whatsapp.net');
    });

    it('should strip symbols, spaces, and punctuation from phone numbers', () => {
      expect(WhatsAppJid.normalize('+91 (987) 654-3210')).toBe('919876543210@s.whatsapp.net');
    });

    it('should normalize case and trim whitespace for existing PNJIDs', () => {
      expect(WhatsAppJid.normalize('  919876543210@s.whatsapp.net  ')).toBe('919876543210@s.whatsapp.net');
      expect(WhatsAppJid.normalize('919876543210@S.WHATSAPP.NET')).toBe('919876543210@s.whatsapp.net');
    });

    it('should strip multi-device suffixes from PNJID and LIDJID', () => {
      expect(WhatsAppJid.normalize('919876543210:2@s.whatsapp.net')).toBe('919876543210@s.whatsapp.net');
      expect(WhatsAppJid.normalize('123456789012345:1@lid')).toBe('123456789012345@lid');
    });

    it('should normalize valid LIDJIDs', () => {
      expect(WhatsAppJid.normalize('123456789012345@lid')).toBe('123456789012345@lid');
    });

    it('should return null for non-user domains', () => {
      expect(WhatsAppJid.normalize('123456789-987654@g.us')).toBeNull();
      expect(WhatsAppJid.normalize('status@broadcast')).toBeNull();
      expect(WhatsAppJid.normalize('newsletter@broadcast')).toBeNull();
      expect(WhatsAppJid.normalize('someone@example.com')).toBeNull();
    });

    it('should return null for empty or non-digit strings', () => {
      expect(WhatsAppJid.normalize('')).toBeNull();
      expect(WhatsAppJid.normalize('   ')).toBeNull();
      expect(WhatsAppJid.normalize('not-a-number')).toBeNull();
      expect(WhatsAppJid.normalize('+++---()')).toBeNull();
    });
  });

  describe('isUser, isPnUser, and isLidUser', () => {
    it('should correctly identify PNJIDs', () => {
      expect(WhatsAppJid.isUser('919876543210@s.whatsapp.net')).toBe(true);
      expect(WhatsAppJid.isPnUser('919876543210@s.whatsapp.net')).toBe(true);
      expect(WhatsAppJid.isLidUser('919876543210@s.whatsapp.net')).toBe(false);
    });

    it('should correctly identify LIDJIDs', () => {
      expect(WhatsAppJid.isUser('123456789012345@lid')).toBe(true);
      expect(WhatsAppJid.isPnUser('123456789012345@lid')).toBe(false);
      expect(WhatsAppJid.isLidUser('123456789012345@lid')).toBe(true);
    });

    it('should return false for groups, broadcasts, or invalid JIDs', () => {
      expect(WhatsAppJid.isUser('123456789@g.us')).toBe(false);
      expect(WhatsAppJid.isUser('status@broadcast')).toBe(false);
      expect(WhatsAppJid.isUser('invalid')).toBe(false);
    });
  });

  describe('isGroup and isBroadcast', () => {
    it('should correctly identify group JIDs', () => {
      expect(WhatsAppJid.isGroup('123456789-987654@g.us')).toBe(true);
      expect(WhatsAppJid.isGroup('919876543210@s.whatsapp.net')).toBe(false);
    });

    it('should correctly identify broadcast JIDs', () => {
      expect(WhatsAppJid.isBroadcast('status@broadcast')).toBe(true);
      expect(WhatsAppJid.isBroadcast('919876543210@s.whatsapp.net')).toBe(false);
    });
  });

  describe('toPhoneNumber', () => {
    it('should extract digits from PNJID', () => {
      expect(WhatsAppJid.toPhoneNumber('919876543210@s.whatsapp.net')).toBe('919876543210');
      expect(WhatsAppJid.toPhoneNumber('919876543210:2@s.whatsapp.net')).toBe('919876543210');
    });

    it('should extract digits from raw phone number string', () => {
      expect(WhatsAppJid.toPhoneNumber('+91 (987) 654-3210')).toBe('919876543210');
    });

    it('should return null for LIDJIDs or non-user JIDs', () => {
      expect(WhatsAppJid.toPhoneNumber('123456789012345@lid')).toBeNull();
      expect(WhatsAppJid.toPhoneNumber('123456789@g.us')).toBeNull();
    });
  });

  describe('areSameUser', () => {
    it('should match identical users across device suffixes', () => {
      expect(
        WhatsAppJid.areSameUser('919876543210:2@s.whatsapp.net', '919876543210@s.whatsapp.net')
      ).toBe(true);
      expect(
        WhatsAppJid.areSameUser('123456789012345:1@lid', '123456789012345@lid')
      ).toBe(true);
    });

    it('should return false for distinct users', () => {
      expect(
        WhatsAppJid.areSameUser('919876543210@s.whatsapp.net', '15551234567@s.whatsapp.net')
      ).toBe(false);
    });

    it('should return false when given invalid or non-user identifiers', () => {
      expect(WhatsAppJid.areSameUser('invalid_a', 'invalid_b')).toBe(false);
      expect(WhatsAppJid.areSameUser('', '')).toBe(false);
      expect(WhatsAppJid.areSameUser('123@g.us', '123@g.us')).toBe(false);
    });
  });
});
