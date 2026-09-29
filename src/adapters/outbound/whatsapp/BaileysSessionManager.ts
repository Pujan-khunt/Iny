import * as fs from 'fs';
import { useMultiFileAuthState, AuthenticationState } from '@whiskeysockets/baileys';
import { LoggerPort } from '../../../core/ports/LoggerPort';

export interface BaileysSession {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}

/**
 * Manages the persistence lifecycle of WhatsApp authentication state on disk.
 */
export class BaileysSessionManager {
  private authDir: string;

  constructor(private logger: LoggerPort, authDir: string = '.baileys_auth') {
    this.authDir = authDir;
  }

  /**
   * Initializes or restores the WhatsApp authentication session from disk.
   *
   * @param authDir Optional override for the directory where Baileys credentials files are stored.
   * @returns An object containing the authentication state and a saveCreds callback.
   */
  async initSession(authDir?: string): Promise<BaileysSession> {
    if (authDir) {
      this.authDir = authDir;
    }
    return useMultiFileAuthState(this.authDir);
  }

  /**
   * Purges the authentication session directory from disk upon logout.
   */
  async purgeSession(): Promise<void> {
    try {
      await fs.promises.rm(this.authDir, { recursive: true, force: true });
      this.logger.info('WhatsApp session credentials purged successfully', { authDir: this.authDir });
    } catch (err) {
      this.logger.error('Failed to purge session credentials', err, { authDir: this.authDir });
      throw err;
    }
  }
}
