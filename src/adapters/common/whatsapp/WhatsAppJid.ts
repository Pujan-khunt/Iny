/**
 * Utility collaborator for parsing, formatting, and classifying WhatsApp JIDs.
 */
export class WhatsAppJid {
  /**
   * Normalizes a phone number or user JID string to standard `number@s.whatsapp.net` format.
   * Returns null if the identifier is not a valid phone number or individual user JID.
   */
  static normalize(raw: string): string | null {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) {
      return null;
    }

    if (trimmed.endsWith('@s.whatsapp.net')) {
      const user = trimmed.replace('@s.whatsapp.net', '');
      return /^\d+$/.test(user) ? `${user}@s.whatsapp.net` : null;
    }

    // Any other '@' domain cannot be an individual user JID
    if (trimmed.includes('@')) {
      return null;
    }

    const digitsOnly = trimmed.replace(/\D/g, '');
    if (!digitsOnly) {
      return null;
    }

    return `${digitsOnly}@s.whatsapp.net`;
  }

  /**
   * Returns true if the JID represents a WhatsApp group chat.
   */
  static isGroup(jid: string): boolean {
    return jid.trim().toLowerCase().endsWith('@g.us');
  }

  /**
   * Returns true if the JID represents a WhatsApp status or broadcast channel.
   */
  static isBroadcast(jid: string): boolean {
    const trimmed = jid.trim().toLowerCase();
    return trimmed === 'status@broadcast' || trimmed.endsWith('@broadcast');
  }

  /**
   * Returns true if the JID represents an individual WhatsApp user.
   */
  static isUser(jid: string): boolean {
    const trimmed = jid.trim().toLowerCase();
    if (!trimmed.endsWith('@s.whatsapp.net')) {
      return false;
    }
    const user = trimmed.replace('@s.whatsapp.net', '');
    return /^\d+$/.test(user);
  }
}
