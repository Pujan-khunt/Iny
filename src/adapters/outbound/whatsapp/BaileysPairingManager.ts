import { LoggerPort } from '../../../core/ports/LoggerPort';

export interface PairingCapableSocket {
  requestPairingCode: (phone: string) => Promise<string>;
  authState: {
    creds: {
      registered: boolean;
    };
  };
}

/**
 * Coordinates first-time device pairing and registration with WhatsApp.
 */
export class BaileysPairingManager {
  constructor(private logger: LoggerPort) {}

  /**
   * Initiates device pairing for an unregistered WhatsApp session.
   *
   * @param sock The active socket or pairing-capable connection.
   * @param botPhoneNumber The phone number associated with the bot.
   * @returns The generated pairing code string, or null if already registered.
   */
  async pair(
    sock: PairingCapableSocket,
    botPhoneNumber: string
  ): Promise<string | null> {
    if (sock.authState.creds.registered) {
      this.logger.debug('Device is already registered, skipping device pairing');
      return null;
    }

    const cleanPhone = botPhoneNumber.replace(/\D/g, '');
    try {
      const code = await sock.requestPairingCode(cleanPhone);
      this.logger.info(
        'WhatsApp pairing code generated. Enter this in WhatsApp > Linked Devices > Link with phone number.',
        { pairingCode: code }
      );
      return code;
    } catch (err) {
      this.logger.error('Failed to pair WhatsApp device', err);
      throw err;
    }
  }
}
