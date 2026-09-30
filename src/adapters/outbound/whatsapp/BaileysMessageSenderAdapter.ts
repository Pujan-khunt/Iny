import { MessageSenderPort } from '../../../core/ports/MessageSenderPort';
import { LoggerPort } from '../../../core/ports/LoggerPort';
import { BaileysConnectionManager } from './BaileysConnectionManager';
import { AllowlistPort } from '../access-control/AllowlistPort';
import { WhatsAppAllowlist } from '../../common/access-control/WhatsAppAllowlist';

/**
 * Outbound transport adapter implementing MessageSenderPort with defense-in-depth
 * allowlist verification before transmitting messages over WhatsApp socket.
 */
export class BaileysMessageSenderAdapter implements MessageSenderPort {
  constructor(
    private connectionManager: BaileysConnectionManager,
    private allowlist: AllowlistPort | WhatsAppAllowlist,
    private logger: LoggerPort
  ) {}

  async sendMessage(userId: string, content: string): Promise<void> {
    const isAllowed = await this.allowlist.isAllowed(userId);
    if (!isAllowed) {
      this.logger.warn(
        'Blocked outbound message to unauthorized recipient (defense-in-depth)',
        undefined,
        { userId }
      );
      return;
    }

    const socket = this.connectionManager.getSocket();
    if (!socket) {
      throw new Error('WhatsApp socket is not connected');
    }

    try {
      await socket.sendMessage(userId, { text: content });
    } catch (err) {
      this.logger.error('Failed to send WhatsApp message', err, { recipientJid: userId });
      throw err;
    }
  }
}
