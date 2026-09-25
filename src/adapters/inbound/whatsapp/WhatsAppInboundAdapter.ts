import { proto } from '@whiskeysockets/baileys';
import { ProcessIncomingMessage } from '../../../core/use-cases/ProcessIncomingMessage';
import { BaileysConnectionManager } from '../../outbound/whatsapp/BaileysConnectionManager';
import { WhatsAppAllowlist } from '../../common/access-control/WhatsAppAllowlist';
import { BaileysMessageParser } from './BaileysMessageParser';
import { LoggerPort } from '../../../core/ports/LoggerPort';

/**
 * Driving adapter that listens for incoming WhatsApp messages from Baileys,
 * enforces allowlist authorization, parses payloads, and triggers ProcessIncomingMessage.
 */
export class WhatsAppInboundAdapter {
  constructor(
    private processIncomingMessage: ProcessIncomingMessage,
    private connectionManager: BaileysConnectionManager,
    private allowlist: WhatsAppAllowlist,
    private parser: BaileysMessageParser,
    private logger: LoggerPort
  ) {}

  /**
   * Registers the message upsert listener with the Baileys connection manager.
   */
  start(): void {
    this.connectionManager.onIncomingMessages((messages) => this.handleMessages(messages));
    this.logger.info('WhatsApp inbound adapter listening for incoming messages');
  }

  /**
   * Handles a batch of incoming raw WebMessageInfo objects from Baileys.
   *
   * @param messages The raw messages received from the WhatsApp connection.
   */
  async handleMessages(messages: proto.IWebMessageInfo[]): Promise<void> {
    for (const raw of messages) {
      const senderJid = raw.key?.remoteJid;
      if (!senderJid) {
        continue;
      }

      if (!this.allowlist.isAllowed(senderJid)) {
        this.logger.debug('Ignored message from unauthorized sender', { senderJid });
        continue;
      }

      const userMessage = this.parser.parse(raw);
      if (!userMessage) {
        continue;
      }

      try {
        await this.processIncomingMessage.execute(userMessage);
      } catch (err) {
        this.logger.error('Unhandled error processing incoming message', err, {
          messageId: userMessage.id,
        });
      }
    }
  }
}
