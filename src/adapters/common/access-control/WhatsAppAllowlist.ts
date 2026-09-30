import { WhatsAppJid } from '../whatsapp/WhatsAppJid';

/**
 * Access control collaborator that enforces permission allowlisting
 * against authorized WhatsApp identities.
 */
export class WhatsAppAllowlist {
  private readonly allowedJids: Set<string>;

  constructor(allowedUsers: string[]) {
    this.allowedJids = new Set(
      allowedUsers
        .map((entry) => WhatsAppJid.normalize(entry))
        .filter((jid): jid is string => jid !== null)
    );
  }

  /**
   * Returns true if the provided identifier maps to an authorized user.
   */
  isAllowed(rawJidOrPhone: string): boolean {
    const normalized = WhatsAppJid.normalize(rawJidOrPhone);
    if (!normalized) {
      return false;
    }
    return this.allowedJids.has(normalized);
  }

  /**
   * Stub for transitional interface compatibility with AllowlistPort.
   */
  async getUser(_address: string): Promise<null> {
    return null;
  }
}
