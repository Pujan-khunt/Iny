import { WAMessage } from '@whiskeysockets/baileys';
import { ProcessIncomingMessage } from '../../../core/use-cases/ProcessIncomingMessage';
import { BaileysConnectionManager } from '../../outbound/whatsapp/BaileysConnectionManager';
import { AccessControlPort } from '../../../core/ports/AccessControlPort';
import { BaileysMessageFilter } from './BaileysMessageFilter';
import { BaileysMessageParser } from './BaileysMessageParser';
import { LoggerPort } from '../../../core/ports/LoggerPort';
import { UserMessage } from '../../../core/entities/Message';
import { WhatsAppJid } from '../../common/whatsapp/WhatsAppJid';

/**
 * Driving adapter that listens for incoming WhatsApp messages from Baileys,
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
  ) {}

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
   * Handles a batch of incoming raw WebMessageInfo objects from Baileys.
   *
   * @param messages The raw messages received from the WhatsApp connection.
   */
  async handleMessages(messages: WAMessage[]): Promise<void> {
    for (const raw of messages) {
      // Stage 1: Eligibility check (reject fromMe, groups, broadcasts, non-text)
      if (!this.filter.isEligible(raw)) {
        continue;
      }

      const remoteJid = raw.key.remoteJid;
      const remoteJidAlt = raw.key.remoteJidAlt;

      // Extract lookup address and companion LIDJID for access control routing
      const { lookupAddress, companionLidJid } = this.resolveSenderRouting(remoteJid, remoteJidAlt);
      this.logger.debug('Resolved sender routing', {
        remoteJid,
        remoteJidAlt,
        lookupAddress,
        companionLidJid,
      });

      // Stage 2: Access control authorization & identity retrieval
      const user = await this.accessControl.authenticate(lookupAddress, companionLidJid);
      if (!user) {
        this.logger.debug('Ignored message from unauthorized sender', { remoteJid, remoteJidAlt });
        continue;
      }

      // Stage 3: Pure transformation (user.pnJid is verified canonical phone identity)
      let userMessage: UserMessage;
      try {
        userMessage = this.parser.parse(raw, user.pnJid);
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
        });
      }
    }
  }

  /**
   * Resolves incoming stanza keys into the database query address and optional companion LIDJID.
   *
   * WhatsApp dual identity handling:
   * 1. Linked Identity (LID) stanza:
   *    - First interaction (accompanied): `remoteJid` is `<lid>@lid`, `remoteJidAlt` is `<phone>@s.whatsapp.net`.
   *      Query by phone number to match newly seeded users whose LID is not yet known. Cache the new LID.
   *    - Subsequent interaction: `remoteJid` is `<lid>@lid`, `remoteJidAlt` is undefined.
   *      Query directly by already-cached LID. Nothing new to cache.
   *
   * 2. Phone Number (PN) stanza:
   *    - `remoteJid` is `<phone>@s.whatsapp.net`. Query by phone number.
   *    - Cache companion LID if present in `remoteJidAlt`.
   */
  private resolveSenderRouting(
    remoteJid: string,
    remoteJidAlt?: string
  ): { lookupAddress: string; companionLidJid: string | null } {
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
