import { Boom } from '@hapi/boom';
import makeWASocket, {
  DisconnectReason,
  WASocket,
  BaileysEventMap,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { LoggerPort } from '../../../core/ports/LoggerPort';
import { BaileysPairingManager } from './BaileysPairingManager';
import { BaileysSession, BaileysSessionManagerPort } from './PostgresBaileysSessionManager';

export interface StartConnectionOptions {
  session: BaileysSession;
  botPhoneNumber: string;
}

export interface ConnectionCloseDecision {
  shouldReconnect: boolean;
  purgeSession: boolean;
}

export type BaileysEventHandler<T extends keyof BaileysEventMap> = (
  data: BaileysEventMap[T]
) => Promise<void> | void;

/**
 * Coordinates Baileys WebSocket lifecycle, connection updates, and reconnection policy.
 */
export class BaileysConnectionManager {
  private socket: WASocket | null = null;
  private isShuttingDown = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscribers = new Map<
    keyof BaileysEventMap,
    Array<BaileysEventHandler<any>>
  >();

  constructor(
    private logger: LoggerPort,
    private pairingManager: BaileysPairingManager,
    private sessionManager: BaileysSessionManagerPort
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

  /**
   * Disconnects the active socket and cancels any pending reconnection attempts.
   */
  disconnect(): void {
    this.isShuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
  }

  /**
   * Subscribes to a specific Baileys event across current and future socket reconnections.
   * Returns an unsubscribe function.
   */
  subscribe<T extends keyof BaileysEventMap>(
    event: T,
    handler: BaileysEventHandler<T>
  ): () => void {
    const current = this.subscribers.get(event) ?? [];
    current.push(handler);
    this.subscribers.set(event, current);

    return () => {
      const handlers = this.subscribers.get(event) ?? [];
      this.subscribers.set(
        event,
        handlers.filter((h) => h !== handler)
      );
    };
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
    this.isShuttingDown = false;
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
          if (this.isShuttingDown) {
            this.logger.info('WhatsApp connection closed during shutdown');
            return;
          }
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
            this.reconnectTimer = setTimeout(() => this.start(options), 3000);
          }
        }
      }

      for (const [eventName, handlers] of this.subscribers.entries()) {
        const eventData = events[eventName];
        if (eventData && handlers.length > 0) {
          const results = await Promise.allSettled(
            handlers.map(async (handler) => handler(eventData))
          );

          for (const result of results) {
            if (result.status === 'rejected') {
              this.logger.error(`Handler failed for event "${String(eventName)}"`, result.reason, {
                eventName,
              });
            }
          }
        }
      }
    });
  }
}
