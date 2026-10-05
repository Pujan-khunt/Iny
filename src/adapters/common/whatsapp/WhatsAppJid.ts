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
 * Stateless utility for normalizing, classifying, and comparing WhatsApp JIDs.
 * Thin wrapper over @whiskeysockets/baileys JID helpers that adds input
 * trimming/lowercasing and handles the PNJID (@s.whatsapp.net) / LIDJID (@lid) duality.
 * Does not parse messages or resolve a LIDJID to a PNJID (or the reverse).
 */
export class WhatsAppJid {
  /**
   * Normalizes an identifier into its canonical, lowercase individual-user JID.
   *
   * Returns:
   * - A PNJID (`<digits>@s.whatsapp.net`) when given a raw phone number (formatting
   *   characters are stripped; must be 7-15 digits, i.e. E.164 length) or a PNJID.
   *   Device suffixes (e.g. `:1`) are removed.
   * - A LIDJID (`<id>@lid`), with any device suffix removed, when given a LIDJID.
   * - `null` when the input is empty, has an invalid digit count (phone numbers only),
   *   or is a JID that is not an individual user (e.g. group or broadcast).
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

    // 2. Otherwise treat as a raw phone number: strip non-digits and validate E.164 length (7-15 digits)
    const digitsOnly = trimmed.replace(/\D/g, '');
    if (digitsOnly.length < 7 || digitsOnly.length > 15) {
      return null;
    }

    return `${digitsOnly}${S_WHATSAPP_NET}`;
  }

  /**
   * Returns true if the JID represents an individual WhatsApp user (either PNJID or LIDJID).
   */
  static isUser(jid: string): boolean {
    const normalized = jidNormalizedUser(jid.trim().toLowerCase());
    return Boolean(isPnUser(normalized) || isLidUser(normalized));
  }

  /**
   * Returns true specifically if the JID is a phone number user (@s.whatsapp.net).
   */
  static isPnUser(jid: string): boolean {
    const normalized = jidNormalizedUser(jid.trim().toLowerCase());
    return Boolean(isPnUser(normalized));
  }

  /**
   * Returns true specifically if the JID is a linked identity user (@lid).
   */
  static isLidUser(jid: string): boolean {
    const normalized = jidNormalizedUser(jid.trim().toLowerCase());
    return Boolean(isLidUser(normalized));
  }

  /**
   * Returns true if the JID represents a WhatsApp group chat (@g.us).
   */
  static isGroup(jid: string): boolean {
    return Boolean(isJidGroup(jid.trim().toLowerCase()));
  }

  /**
   * Returns true if the JID represents a WhatsApp broadcast channel.
   */
  static isBroadcast(jid: string): boolean {
    return Boolean(isJidBroadcast(jid.trim().toLowerCase()));
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
   * Returns false if either identifier is not a valid user.
   */
  static areSameUser(jid1: string, jid2: string): boolean {
    if (!this.isUser(jid1) || !this.isUser(jid2)) {
      return false;
    }
    return Boolean(areJidsSameUser(jid1.trim().toLowerCase(), jid2.trim().toLowerCase()));
  }
}
