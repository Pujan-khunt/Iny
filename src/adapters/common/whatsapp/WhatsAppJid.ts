import {
  jidNormalizedUser,
  isPnUser,
  isLidUser,
  isJidGroup,
  isJidBroadcast,
  areJidsSameUser,
  S_WHATSAPP_NET,
} from '@whiskeysockets/baileys';

/**
 * Utility collaborator for parsing, formatting, and classifying WhatsApp JIDs.
 * Integrates natively with @whiskeysockets/baileys for PN and LID duality handling.
 */
export class WhatsAppJid {
  /**
   * Normalizes an identifier (phone number, PNJID, or LIDJID) into its standard canonical user form.
   * Strips multi-device suffixes (e.g. :1, :2) and returns lowercase user JID.
   * Returns null if the identifier is malformed or not a direct user.
   */
  static normalize(raw: string): string | null {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) {
      return null;
    }

    // 1. If it contains an '@' stanza address, use Baileys normalization
    if (trimmed.includes('@')) {
      const normalized = jidNormalizedUser(trimmed);
      if (isPnUser(normalized) || isLidUser(normalized)) {
        return normalized;
      }
      return null;
    }

    // 2. Otherwise treat as a raw phone number: strip non-digits
    const digitsOnly = trimmed.replace(/\D/g, '');
    if (!digitsOnly) {
      return null;
    }

    return `${digitsOnly}${S_WHATSAPP_NET}`;
  }

  /**
   * Returns true if the JID represents an individual WhatsApp user (either PNJID or LIDJID).
   */
  static isUser(jid: string): boolean {
    const normalized = jidNormalizedUser(jid.trim().toLowerCase());
    return isPnUser(normalized) || isLidUser(normalized);
  }

  /**
   * Returns true specifically if the JID is a phone number user (@s.whatsapp.net).
   */
  static isPnUser(jid: string): boolean {
    const normalized = jidNormalizedUser(jid.trim().toLowerCase());
    return isPnUser(normalized);
  }

  /**
   * Returns true specifically if the JID is a linked identity user (@lid).
   */
  static isLidUser(jid: string): boolean {
    const normalized = jidNormalizedUser(jid.trim().toLowerCase());
    return isLidUser(normalized);
  }

  /**
   * Returns true if the JID represents a WhatsApp group chat (@g.us).
   */
  static isGroup(jid: string): boolean {
    return isJidGroup(jid.trim().toLowerCase());
  }

  /**
   * Returns true if the JID represents a WhatsApp broadcast channel.
   */
  static isBroadcast(jid: string): boolean {
    return isJidBroadcast(jid.trim().toLowerCase());
  }

  /**
   * Extracts clean phone number digits from a PNJID or raw phone string.
   * Returns null if the input is an LID or not a phone-based identifier.
   */
  static toPhoneNumber(rawOrJid: string): string | null {
    const normalized = this.normalize(rawOrJid);
    if (!normalized || !this.isPnUser(normalized)) {
      return null;
    }
    return normalized.replace(S_WHATSAPP_NET, '');
  }

  /**
   * Compares two JIDs ignoring multi-device suffixes within the same identity form.
   */
  static areSameUser(jid1: string, jid2: string): boolean {
    return areJidsSameUser(jid1.trim().toLowerCase(), jid2.trim().toLowerCase());
  }
}
