import { normalizeMessageContent, proto, WAMessage, WAMessageKey } from '@whiskeysockets/baileys';
import { WhatsAppJid } from '../../common/whatsapp/WhatsAppJid';

/**
 * Refined shape of a raw Baileys WebMessageInfo that has passed all eligibility checks.
 */
export type EligibleWebMessageInfo = WAMessage & {
  key: WAMessageKey & {
    remoteJid: string;
    id: string;
  };
  message: proto.IMessage;
};

export type IneligibilityReason =
  | 'missing_key'
  | 'from_me'
  | 'missing_address'
  | 'group_or_broadcast'
  | 'non_text';

export type EligibilityResult =
  | { eligible: true; message: EligibleWebMessageInfo }
  | { eligible: false; reason: IneligibilityReason };

/**
 * Evaluates whether an incoming raw WhatsApp message is eligible for processing.
 * Enforces reception policy (e.g. 1-on-1 direct messages only, text only, not from self).
 */
export class BaileysMessageFilter {
  evaluate(raw?: proto.IWebMessageInfo | null): EligibilityResult {
    // 1. Reject null, undefined, or malformed payloads missing envelope metadata keys.
    if (!raw || !raw.key) {
      return { eligible: false, reason: 'missing_key' };
    }

    // 2. Reject messages sent by the bot itself to prevent infinite automated self-reply loops.
    if (raw.key.fromMe) {
      return { eligible: false, reason: 'from_me' };
    }

    // 3. Reject messages without a remote sender address or message ID; a reply cannot be delivered without an addressable destination or stanza identity.
    const remoteJid = raw.key.remoteJid;
    const id = raw.key.id;
    if (!remoteJid || !id) {
      return { eligible: false, reason: 'missing_address' };
    }

    // 4. Reject group chats (@g.us) and status broadcasts (@broadcast) to prevent unsolicited mass-messaging. Iny v1 is scoped strictly to 1-on-1 direct conversations.
    if (WhatsAppJid.isGroup(remoteJid) || WhatsAppJid.isBroadcast(remoteJid)) {
      return { eligible: false, reason: 'group_or_broadcast' };
    }

    // 5. Reject non-text messages (e.g. images, audio, stickers, reactions); Iny currently processes textual instructions only.
    if (!this.hasTextContent(raw.message)) {
      return { eligible: false, reason: 'non_text' };
    }

    return {
      eligible: true,
      message: raw as EligibleWebMessageInfo,
    };
  }

  private hasTextContent(message?: proto.IMessage | null): message is proto.IMessage {
    if (!message) {
      return false;
    }

    const unwrapped = normalizeMessageContent(message);
    if (!unwrapped) {
      return false;
    }

    if (unwrapped.conversation && unwrapped.conversation.trim().length > 0) {
      return true;
    }

    if (unwrapped.extendedTextMessage?.text && unwrapped.extendedTextMessage.text.trim().length > 0) {
      return true;
    }

    return false;
  }
}
