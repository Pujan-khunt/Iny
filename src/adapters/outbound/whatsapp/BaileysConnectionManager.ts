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

/**
 * Configuration options for initializing a Baileys WhatsApp connection.
 */
export interface StartConnectionOptions {
  /** Authenticated session state and credential management helpers. */
  session: BaileysSession;
  /** Primary bot phone number used to request pairing code when unregistered. */
  botPhoneNumber: string;
}

/**
 * Policy decision determining reconnection behavior and credential purge requirements on socket close.
 */
export interface ConnectionCloseDecision {
  /** True if the connection manager should schedule an automated reconnection attempt. */
  shouldReconnect: boolean;
  /** True if persisted session credentials are invalid/logged-out and must be deleted. */
  purgeSession: boolean;
}

/**
 * Event subscriber callback signature for typed Baileys event notifications.
 */
export type BaileysEventHandler<T extends keyof BaileysEventMap> = (
  data: BaileysEventMap[T]
) => Promise<void> | void;

/**
 * Coordinates Baileys WebSocket lifecycle, phone pairing, event dispatching,
 * and disconnect error recovery policies.
 */
export class BaileysConnectionManager {
  private socket: WASocket | null = null;
  private isShuttingDown = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscribers = new Map<
    keyof BaileysEventMap,
    Array<BaileysEventHandler<any>>
  >();

  /**
   * @param logger Leveled structured logger port.
   * @param pairingManager Manager responsible for pairing code requests during onboarding.
   * @param sessionManager Port managing persistence and purging of WhatsApp auth state.
   */
  constructor(
    private logger: LoggerPort,
    private pairingManager: BaileysPairingManager,
    private sessionManager: BaileysSessionManagerPort
  ) {}

  /**
   * Checks whether an active WhatsApp socket connection exists.
   */
  isConnected(): boolean {
    return this.socket !== null;
  }

  /**
   * Directly sets or clears the active socket instance.
   */
  setSocket(socket: WASocket | null): void {
    this.socket = socket;
  }

  /**
   * Retrieves the active socket instance, or null if disconnected.
   */
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
   * Handlers run with fault isolation via Promise.allSettled.
   *
   * @param event The Baileys event name to listen for.
   * @param handler Async or sync callback invoked when the event occurs.
   * @returns An unsubscription function.
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

  /**
   * Evaluates a socket disconnect error to decide whether to reconnect or purge credentials:
   * - 401 (loggedOut): Purges session credentials; does not reconnect.
   * - 400 (badSession): Corrupted session; does not reconnect without manual intervention.
   * - 515 (restartRequired): Server requests restart; reconnects immediately.
   * - Transient disconnects (network drop): Logs warning and triggers scheduled reconnection.
   *
   * @param lastDisconnectError The error received from Baileys connection.update.
   * @returns Policy decision with shouldReconnect and purgeSession flags.
   */
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

  /**
   * Starts the Baileys WebSocket connection and begins event processing.
   * Automatically coordinates pairing code generation, credential saving,
   * subscriber dispatching, and reconnection on unexpected disconnects.
   *
   * @param options Connection options including session state and bot phone number.
   */
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
