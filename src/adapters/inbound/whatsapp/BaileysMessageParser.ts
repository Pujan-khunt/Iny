import * as crypto from 'crypto';
import { proto } from '@whiskeysockets/baileys';
import { UserMessage } from '../../../core/entities/Message';

/**
 * Pure parser that extracts plain text and domain metadata from raw Baileys WAMessages.
 */
export class BaileysMessageParser {
  /**
   * Parses a raw Baileys proto.IWebMessageInfo into a domain UserMessage entity.
   * Returns null if the message should be ignored (e.g. self messages, groups,
   * broadcasts, or non-text payloads).
   *
   * @param raw The raw WebMessageInfo from Baileys.
   * @returns A valid UserMessage or null if discarded.
   */
  parse(raw: proto.IWebMessageInfo): UserMessage | null {
    if (!raw.key || raw.key.fromMe) {
      return null;
    }

    const remoteJid = raw.key.remoteJid;
    if (
      !remoteJid ||
      remoteJid.endsWith('@g.us') ||
      remoteJid === 'status@broadcast' ||
      remoteJid.endsWith('@broadcast')
    ) {
      return null;
    }

    const text = this.extractText(raw.message);
    if (!text || !text.trim()) {
      return null;
    }

    let timestampSeconds: number;
    if (typeof raw.messageTimestamp === 'number' && raw.messageTimestamp > 0) {
      timestampSeconds = raw.messageTimestamp;
    } else if (
      raw.messageTimestamp &&
      typeof raw.messageTimestamp === 'object' &&
      'low' in raw.messageTimestamp &&
      typeof (raw.messageTimestamp as { low: number }).low === 'number' &&
      (raw.messageTimestamp as { low: number }).low > 0
    ) {
      timestampSeconds = (raw.messageTimestamp as { low: number }).low;
    } else if (
      raw.messageTimestamp &&
      typeof (raw.messageTimestamp as { toNumber?: () => number }).toNumber === 'function'
    ) {
      const num = (raw.messageTimestamp as { toNumber: () => number }).toNumber();
      timestampSeconds = num > 0 ? num : Math.floor(Date.now() / 1000);
    } else {
      const parsedNum = Number(raw.messageTimestamp);
      timestampSeconds =
        Number.isFinite(parsedNum) && parsedNum > 0
          ? parsedNum
          : Math.floor(Date.now() / 1000);
    }

    return {
      id: raw.key.id || crypto.randomUUID(),
      userId: remoteJid,
      role: 'user',
      content: text.trim(),
      timestamp: new Date(timestampSeconds * 1000),
    };
  }

  private extractText(message?: proto.IMessage | null): string | null {
    if (!message) {
      return null;
    }
    if (message.conversation) {
      return message.conversation;
    }
    if (message.extendedTextMessage?.text) {
      return message.extendedTextMessage.text;
    }
    return null;
  }
}
