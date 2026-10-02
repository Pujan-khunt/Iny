import { normalizeMessageContent, proto } from '@whiskeysockets/baileys';
import { UserMessage } from '../../../core/entities/Message';
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

    return {
      id: raw.key.id,
      userId: canonicalUserId,
      content: text ? text.trim() : '',
      timestamp: new Date(timestampSeconds * 1000),
      role: 'user',
    };
  }

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
   *
   * Background & Schema:
   * In WhatsApp Protocol Buffers (`WAProto.proto`), messageTimestamp is defined as:
   *   `optional uint64 messageTimestamp = 3;` (Unix epoch seconds).
   *
   * Because JavaScript's native Number is an IEEE-754 double (64 bits) with a 53-bit safe integer
   * limit (`Number.MAX_SAFE_INTEGER`), `protobuf.js` uses `Long.js` to represent 64-bit
   * values as split 32-bit words: `{ low: number, high: number, unsigned: boolean }`.
   *
   * Consequently, Baileys emits `messageTimestamp` in multiple inconsistent runtime shapes:
   * 1. Primitive `number`: When parsed directly from XML stanza attributes (e.g. `+stanza.attrs.t`).
   * 2. `Long` class instance: When decoded from binary protobufs, exposing a `.toNumber()` method.
   * 3. Plain object `{ low, high }`: When deserialized from JSON or disk cache where prototype
   *    methods like `.toNumber()` were stripped.
   * 4. String or undefined/null: In synthetic, webhook, or malformed mock payloads.
   *
   * Baileys itself employs this identical normalization pattern internally in its utilities:
   * `toNumber = (t) => typeof t === 'object' && t ? ('toNumber' in t ? t.toNumber() : t.low) : t || 0;`
   */
  private resolveTimestamp(rawTimestamp: proto.IWebMessageInfo['messageTimestamp']): number {
    // 1. Primitive number: Already converted to a native JS number (Unix seconds).
    if (typeof rawTimestamp === 'number') {
      return rawTimestamp;
    }

    // 2. Object representations from Long.js / protobuf deserialization.
    if (rawTimestamp && typeof rawTimestamp === 'object') {
      // 2a. Plain object `{ low: number, high: number }` (e.g. prototypes stripped by JSON.parse).
      // Since current Unix epoch seconds (~1.75e9) easily fit within 32 bits (up to 4.29e9),
      // the `low` word contains the complete timestamp without needing 64-bit math.
      if ('low' in rawTimestamp && typeof (rawTimestamp as { low: number }).low === 'number') {
        return (rawTimestamp as { low: number }).low;
      }

      // 2b. Long.js instance with active prototype methods.
      if (
        'toNumber' in rawTimestamp &&
        typeof (rawTimestamp as { toNumber: () => number }).toNumber === 'function'
      ) {
        return (rawTimestamp as { toNumber: () => number }).toNumber();
      }
    }

    // 3. String numeric coercion (e.g. "1758807200").
    const parsed = Number(rawTimestamp);

    // 4. Safe fallback: If missing, null, NaN, or non-positive, fallback to current system time.
    return Number.isFinite(parsed) && parsed > 0 ? parsed : Math.floor(Date.now() / 1000);
  }
}
