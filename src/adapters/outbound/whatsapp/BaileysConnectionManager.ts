import { Boom } from '@hapi/boom';
import makeWASocket, {
  DisconnectReason,
  proto,
  WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { LoggerPort } from '../../../core/ports/LoggerPort';
import { BaileysPairingManager } from './BaileysPairingManager';
import { BaileysSession, BaileysSessionManager } from './BaileysSessionManager';

export interface StartConnectionOptions {
  session: BaileysSession;
  botPhoneNumber: string;
}

export interface ConnectionCloseDecision {
  shouldReconnect: boolean;
  purgeSession: boolean;
}

/**
 * Coordinates Baileys WebSocket lifecycle, connection updates, and reconnection policy.
 */
export class BaileysConnectionManager {
  private socket: WASocket | null = null;
  private incomingMessagesHandler: ((messages: proto.IWebMessageInfo[]) => Promise<void>) | null = null;

  constructor(
    private logger: LoggerPort,
    private pairingManager: BaileysPairingManager,
    private sessionManager: BaileysSessionManager
  ) {}

  isConnected(): boolean {
    return this.socket !== null;
  }

  setSocket(socket: WASocket | null): void {
    this.socket = socket;
  }

  getSocket(): WASocket | null {
    return this.socket;
  }

  onIncomingMessages(handler: (messages: proto.IWebMessageInfo[]) => Promise<void>): void {
    this.incomingMessagesHandler = handler;
  }

  handleConnectionClose(lastDisconnectError: unknown): ConnectionCloseDecision {
    const statusCode = (lastDisconnectError as Boom)?.output?.statusCode;

    if (statusCode === DisconnectReason.loggedOut) {
      this.logger.fatal('WhatsApp session was logged out by the device. Credential purge required.');
      return { shouldReconnect: false, purgeSession: true };
    }

    if (statusCode === DisconnectReason.badSession) {
      this.logger.fatal('WhatsApp session corrupted or invalid (badSession). Manual restart required.');
      return { shouldReconnect: false, purgeSession: false };
    }

    if (statusCode === DisconnectReason.restartRequired) {
      this.logger.info('WhatsApp restart required by server. Reconnecting immediately.');
      return { shouldReconnect: true, purgeSession: false };
    }

    this.logger.warn(
      'WhatsApp connection closed. Attempting reconnect.',
      lastDisconnectError,
      statusCode !== undefined ? { statusCode } : undefined
    );
    return { shouldReconnect: true, purgeSession: false };
  }

  async start(options: StartConnectionOptions): Promise<void> {
    const sock = makeWASocket({
      auth: options.session.state,
      logger: pino({ level: 'silent' }) as any,
    });

    this.setSocket(sock);

    sock.ev.process(async (events) => {
      if (events['creds.update']) {
        await options.session.saveCreds();
      }

      if (events['connection.update']) {
        const { connection, lastDisconnect, qr } = events['connection.update'];

        if (qr && !sock.authState.creds.registered) {
          await this.pairingManager.pair(sock, options.botPhoneNumber);
        }

        if (connection === 'open') {
          this.logger.info('WhatsApp connection opened successfully');
        } else if (connection === 'close') {
          this.setSocket(null);
          const decision = this.handleConnectionClose(lastDisconnect?.error);
          if (decision.purgeSession) {
            try {
              await this.sessionManager.purgeSession();
            } catch (err) {
              this.logger.error('Failed to purge session credentials', err);
            }
          }
          if (decision.shouldReconnect) {
            this.logger.info('Restarting in 3 seconds');
            setTimeout(() => this.start(options), 3000);
          }
        }
      }

      if (events['messages.upsert']) {
        const upsert = events['messages.upsert'];
        if (upsert.type === 'notify' && this.incomingMessagesHandler) {
          await this.incomingMessagesHandler(upsert.messages);
        }
      }
    });
  }
}
