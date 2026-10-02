import { MessageSenderPort } from '../../../core/ports/MessageSenderPort';
import { LoggerPort } from '../../../core/ports/LoggerPort';
import { BaileysConnectionManager } from './BaileysConnectionManager';

/**
 * Outbound transport adapter implementing MessageSenderPort to transmit messages
 * over the active WhatsApp socket connection.
 */
export class BaileysMessageSenderAdapter implements MessageSenderPort {
  constructor(
    private connectionManager: BaileysConnectionManager,
    private logger: LoggerPort
  ) {}

  async sendMessage(userId: string, content: string): Promise<void> {
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
