import { normalizeMessageContent, proto, toNumber } from '@whiskeysockets/baileys';
import { MessageFactory, UserMessage } from '../../../core/entities/Message';
import { EligibleWebMessageInfo } from './BaileysMessageFilter';

/**
 * Pure translator that maps a raw Baileys WhatsApp message into a domain UserMessage entity.
 */
export class BaileysMessageParser {
  /**
   * Translates an eligible Baileys message into a domain UserMessage.
   *
   * @param raw The eligible inbound Baileys message.
   * @param canonicalUserId The verified canonical phone number JID (@s.whatsapp.net).
   */
  parse(raw: EligibleWebMessageInfo, canonicalUserId: string): UserMessage {
    const text = this.extractText(raw.message);
    const timestampSeconds = this.resolveTimestamp(raw.messageTimestamp);

    return MessageFactory.createUser({
      id: raw.key.id,
      userId: canonicalUserId,
      content: text ? text.trim() : '',
      timestamp: new Date(timestampSeconds * 1000),
    });
  }

  /**
   * Extracts the plain text body from a Baileys message.
   * Unwraps container messages (e.g. ephemeral, view-once) via `normalizeMessageContent`,
   * then reads `conversation` (plain text) or, failing that, `extendedTextMessage.text`
   * (text with reply context, link preview, or mentions).
   *
   * @param message The raw Baileys message payload.
   * @returns The untrimmed text, or null if the message carries no text content.
   */
  private extractText(message: proto.IMessage): string | null {
    const unwrapped = normalizeMessageContent(message);
    if (!unwrapped) {
      return null;
    }

    if (unwrapped.conversation) {
      return unwrapped.conversation;
    }
    if (unwrapped.extendedTextMessage?.text) {
      return unwrapped.extendedTextMessage.text;
    }
    return null;
  }

  /**
   * Resolves the raw WhatsApp message timestamp into Unix epoch seconds.
   * Delegates Protobuf Long and split-word object conversion to Baileys' native `toNumber`,
   * while ensuring safe numeric coercion and fallback to current system time.
   */
  private resolveTimestamp(rawTimestamp: proto.IWebMessageInfo['messageTimestamp']): number {
    const rawNumber = toNumber(rawTimestamp);
    const parsed = Number(rawNumber);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : Math.floor(Date.now() / 1000);
  }
}
