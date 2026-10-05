import { WAMessage } from '@whiskeysockets/baileys';
import { ProcessIncomingMessage } from '../../../core/use-cases/ProcessIncomingMessage';
import { BaileysConnectionManager } from '../../outbound/whatsapp/BaileysConnectionManager';
import { AccessControlPort, UserRecord } from '../../../core/ports/AccessControlPort';
import { BaileysMessageFilter, EligibleWebMessageInfo } from './BaileysMessageFilter';
import { BaileysMessageParser } from './BaileysMessageParser';
import { LoggerPort } from '../../../core/ports/LoggerPort';
import { UserMessage } from '../../../core/entities/Message';
import { WhatsAppJid } from '../../common/whatsapp/WhatsAppJid';

/**
 * Inbound adapter that listens for incoming WhatsApp messages from Baileys,
 * enforces eligibility policy and access control authorization, parses payloads,
 * and triggers ProcessIncomingMessage.
 */
export class WhatsAppInboundAdapter {
  constructor(
    private processIncomingMessage: ProcessIncomingMessage,
    private connectionManager: BaileysConnectionManager,
    private accessControl: AccessControlPort,
    private filter: BaileysMessageFilter,
    private parser: BaileysMessageParser,
    private logger: LoggerPort
  ) { }

  /**
   * Registers the message upsert listener with the Baileys connection manager.
   */
  start(): void {
    this.connectionManager.subscribe('messages.upsert', async (upsert) => {
      if (upsert.type === 'notify') {
        await this.handleMessages(upsert.messages);
      }
    });
    this.logger.info('WhatsApp inbound adapter listening for incoming messages');
  }

  /**
   * Handles a batch of incoming raw WAMessage objects from Baileys.
   *
   * @param messages The raw messages received from the WhatsApp connection.
   */
  async handleMessages(messages: WAMessage[]): Promise<void> {
    for (const raw of messages) {
      // Stage 1: Eligibility check (reject fromMe, groups, broadcasts, non-text)
      const evaluation = this.filter.evaluate(raw);
      if (!evaluation.eligible) {
        this.logger.debug('Ignored ineligible message', {
          messageId: raw?.key?.id,
          remoteJid: raw?.key?.remoteJid,
          reason: evaluation.reason,
        });
        continue;
      }

      const eligible = evaluation.message;

      // Extract lookup address and companion LIDJID for access control routing
      const { lookupAddress, companionLidJid } = this.resolveSenderRouting(eligible);
      this.logger.debug('Resolved sender routing', {
        remoteJid: eligible.key.remoteJid,
        remoteJidAlt: eligible.key.remoteJidAlt,
        lookupAddress,
        companionLidJid,
      });

      // Stage 2: Access control authorization & identity retrieval
      let user: UserRecord | null;
      try {
        user = await this.accessControl.authenticate(lookupAddress, companionLidJid);
      } catch (authError) {
        this.logger.error('Failed to authenticate sender', authError, {
          lookupAddress,
          remoteJid: eligible.key.remoteJid,
          remoteJidAlt: eligible.key.remoteJidAlt,
        });
        continue;
      }

      if (!user) {
        this.logger.debug('Ignored message from unauthorized sender', {
          remoteJid: eligible.key.remoteJid,
          remoteJidAlt: eligible.key.remoteJidAlt,
        });
        continue;
      }

      // Stage 3: Pure transformation (user.pnJid is verified canonical phone identity)
      let userMessage: UserMessage;
      try {
        userMessage = this.parser.parse(eligible, user.pnJid);
      } catch (parseError) {
        this.logger.error('Failed to parse eligible WhatsApp message', parseError);
        continue;
      }

      // Stage 4: Core use-case execution
      try {
        await this.processIncomingMessage.execute(userMessage);
      } catch (err) {
        this.logger.error('Unhandled error processing incoming message', err, {
          messageId: userMessage.id,
          userId: userMessage.userId
        });
      }
    }
  }

  /**
   * Resolves incoming stanza keys from an eligible message into the database lookup address
   * (which may be a PNJID or a LIDJID) and an optional companion LIDJID for caching.
   *
   * @param message An inbound message that has passed eligibility validation.
   * @returns An object containing:
   *   - `lookupAddress`: either a canonical PNJID or LIDJID to query against the `users` table.
   *   - `companionLidJid`: a companion LIDJID to cache in the database if new, or null.
   */
  private resolveSenderRouting(
    message: EligibleWebMessageInfo
  ): { lookupAddress: string; companionLidJid: string | null } {
    const remoteJid = message.key.remoteJid;
    const remoteJidAlt = message.key.remoteJidAlt;

    if (WhatsAppJid.isLidUser(remoteJid)) {
      if (remoteJidAlt && WhatsAppJid.isPnUser(remoteJidAlt)) {
        return { lookupAddress: remoteJidAlt, companionLidJid: remoteJid };
      }
      return { lookupAddress: remoteJid, companionLidJid: null };
    }

    const companionLidJid = remoteJidAlt && WhatsAppJid.isLidUser(remoteJidAlt) ? remoteJidAlt : null;
    return { lookupAddress: remoteJid, companionLidJid };
  }
}
