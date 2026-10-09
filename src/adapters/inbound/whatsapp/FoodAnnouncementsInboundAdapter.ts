import {
  downloadMediaMessage,
  normalizeMessageContent,
  WAMessage,
} from '@whiskeysockets/baileys';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { whatsappGroupFoodAnnouncementsMessages } from '../../outbound/mess/postgres/schema.js';
import { WhatsAppJid } from '../../common/whatsapp/WhatsAppJid.js';
import { BaileysConnectionManager } from '../../outbound/whatsapp/BaileysConnectionManager.js';
import { LoggerPort } from '../../../core/ports/LoggerPort.js';

/**
 * Options required to initialize the FoodAnnouncementsInboundAdapter.
 */
export interface FoodAnnouncementsInboundAdapterOptions {
  /** The WhatsApp group JID for food announcements (e.g. from config.FOOD_ANNOUNCEMENTS_GROUP_JID). */
  targetGroupJid: string;
  /** Drizzle PostgreSQL database client. */
  db: PgDatabase<any, any, any>;
  /** Baileys connection manager to subscribe to inbound WhatsApp events. */
  connectionManager: BaileysConnectionManager;
  /** Leveled structured logger port. */
  logger?: LoggerPort;
  /** Optional custom media download function (defaults to Baileys downloadMediaMessage). */
  downloadMedia?: typeof downloadMediaMessage;
}

const noopLogger: LoggerPort = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => noopLogger,
};

/**
 * Inbound adapter that listens for broadcast messages from the official Food Announcements
 * WhatsApp group, normalizes sender and media content, downloads media attachments,
 * and idempotently inserts raw records into the staging table for manual or automated triage.
 *
 * Invariant: Never sends any reply message to the WhatsApp group.
 */
export class FoodAnnouncementsInboundAdapter {
  private readonly targetGroupJid: string;
  private readonly db: PgDatabase<any, any, any>;
  private readonly connectionManager: BaileysConnectionManager;
  private readonly logger: LoggerPort;
  private readonly downloadMedia: typeof downloadMediaMessage;

  constructor(options: FoodAnnouncementsInboundAdapterOptions) {
    this.targetGroupJid = options.targetGroupJid;
    this.db = options.db;
    this.connectionManager = options.connectionManager;
    this.logger = options.logger ?? noopLogger;
    this.downloadMedia = options.downloadMedia ?? downloadMediaMessage;
  }

  /**
   * Subscribes to Baileys messages.upsert events.
   */
  start(): void {
    this.connectionManager.subscribe('messages.upsert', async (upsert: any) => {
      if (!upsert || !Array.isArray(upsert.messages)) {
        return;
      }
      await this.handleMessages(upsert.messages);
    });

    this.logger.info('Food announcements inbound adapter listening for messages', {
      targetGroupJid: this.targetGroupJid,
    });
  }

  /**
   * Processes a batch of raw inbound WAMessages.
   */
  async handleMessages(messages: WAMessage[]): Promise<void> {
    for (const msg of messages) {
      try {
        await this.processMessage(msg);
      } catch (err) {
        this.logger.error('Unexpected error processing food announcement message', err, {
          messageId: msg?.key?.id,
          remoteJid: msg?.key?.remoteJid,
        });
      }
    }
  }

  /**
   * Evaluates, unwraps, downloads media, and stores a single message.
   */
  private async processMessage(msg: WAMessage): Promise<void> {
    if (!msg?.key) {
      return;
    }

    // 1. Group filtering: Only listen to target announcements group
    if (msg.key.remoteJid !== this.targetGroupJid) {
      return;
    }

    // 2. Reject self-messages silently
    if (msg.key.fromMe === true) {
      return;
    }

    // 3. Must have a valid WhatsApp message ID (wamid)
    if (!msg.key.id) {
      return;
    }

    // 4. Resolve sender participant
    const rawParticipant = msg.key.participant ?? (msg as any).participant;
    if (!rawParticipant) {
      this.logger.debug('Ignored food announcement message missing participant', {
        messageId: msg.key.id,
      });
      return;
    }

    const normalizedSender = WhatsAppJid.normalize(rawParticipant);
    const senderAddress = normalizedSender ?? String(rawParticipant).trim().toLowerCase();
    const senderAddressType: 'pn' | 'lid' = WhatsAppJid.isLidUser(senderAddress) ? 'lid' : 'pn';

    // 5. Inspect and unwrap message content
    if (!msg.message) {
      return;
    }

    const unwrapped = normalizeMessageContent(msg.message);
    if (!unwrapped) {
      return;
    }

    let messageType: 'image' | 'document' | 'text' | null = null;
    let mediaMimeType: string | null = null;
    let textBody: string | null = null;

    if (unwrapped.imageMessage) {
      messageType = 'image';
      mediaMimeType = unwrapped.imageMessage.mimetype ?? 'image/jpeg';
      textBody = unwrapped.imageMessage.caption ?? null;
    } else if (unwrapped.documentMessage) {
      messageType = 'document';
      mediaMimeType = unwrapped.documentMessage.mimetype ?? 'application/pdf';
      textBody = unwrapped.documentMessage.caption ?? unwrapped.documentMessage.fileName ?? null;
    } else if (unwrapped.conversation !== undefined && unwrapped.conversation !== null) {
      messageType = 'text';
      mediaMimeType = null;
      textBody = unwrapped.conversation;
    } else if (
      unwrapped.extendedTextMessage?.text !== undefined &&
      unwrapped.extendedTextMessage?.text !== null
    ) {
      messageType = 'text';
      mediaMimeType = null;
      textBody = unwrapped.extendedTextMessage.text;
    }

    if (!messageType) {
      this.logger.debug('Ignored unsupported message type in food announcements group', {
        messageId: msg.key.id,
      });
      return;
    }

    // 6. Download media buffer if image or document
    let mediaBuffer: Buffer | null = null;
    if (messageType === 'image' || messageType === 'document') {
      try {
        const downloaded = await this.downloadMedia(msg, 'buffer', {});
        mediaBuffer = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded as any);
      } catch (mediaError) {
        this.logger.error('Failed to download media for food announcement message', mediaError, {
          messageId: msg.key.id,
          remoteJid: msg.key.remoteJid,
        });
      }
    }

    // 7. Idempotent insertion into staging inbox
    try {
      await this.db
        .insert(whatsappGroupFoodAnnouncementsMessages)
        .values({
          id: msg.key.id,
          senderAddress,
          senderAddressType,
          messageType,
          textBody,
          mediaMimeType,
          mediaBuffer,
          status: 'pending',
        })
        .onConflictDoNothing();

      this.logger.debug('Stored food announcement message into staging inbox', {
        messageId: msg.key.id,
        senderAddress,
        messageType,
      });
    } catch (dbError) {
      this.logger.error('Failed to store food announcement message in database', dbError, {
        messageId: msg.key.id,
      });
    }
  }
}
