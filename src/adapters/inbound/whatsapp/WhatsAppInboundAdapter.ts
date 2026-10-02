import { WAMessage } from '@whiskeysockets/baileys';
import { ProcessIncomingMessage } from '../../../core/use-cases/ProcessIncomingMessage';
import { BaileysConnectionManager } from '../../outbound/whatsapp/BaileysConnectionManager';
import { AllowlistPort, AllowedUserRecord } from '../../../core/ports/AllowlistPort';
import { BaileysMessageFilter } from './BaileysMessageFilter';
import { BaileysMessageParser } from './BaileysMessageParser';
import { LoggerPort } from '../../../core/ports/LoggerPort';
import { UserMessage } from '../../../core/entities/Message';
import { WhatsAppJid } from '../../common/whatsapp/WhatsAppJid';

/**
 * Driving adapter that listens for incoming WhatsApp messages from Baileys,
 * enforces eligibility policy and allowlist authorization, parses payloads,
 * and triggers ProcessIncomingMessage.
 */
export class WhatsAppInboundAdapter {
  constructor(
    private processIncomingMessage: ProcessIncomingMessage,
    private connectionManager: BaileysConnectionManager,
    private allowlist: AllowlistPort,
    private filter: BaileysMessageFilter,
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
  async handleMessages(messages: WAMessage[]): Promise<void> {
    for (const raw of messages) {
      // Stage 1: Eligibility check (reject fromMe, groups, broadcasts, non-text)
      if (!this.filter.isEligible(raw)) {
        continue;
      }

      const remoteJid = raw.key.remoteJid;
      const remoteJidAlt = raw.key.remoteJidAlt;

      // Extract paired LID and primary candidate address for access control
      const { checkAddress, pairedLid, isLid } = this.resolveSenderAddresses(remoteJid, remoteJidAlt);

      // Stage 2: Access control allowlist & identity retrieval
      const user = await this.allowlist.authenticate(checkAddress, pairedLid);
      if (!user) {
        this.logger.debug('Ignored message from unauthorized sender', { remoteJid, remoteJidAlt });
        continue;
      }

      // Stage 3: Resolve canonical PNJID for unified conversation history
      const canonicalPnJid = this.resolveCanonicalPnJid(remoteJid, remoteJidAlt, isLid, user);
      if (!canonicalPnJid) {
        this.logger.warn('Dropping message: unable to resolve canonical phone identity', {
          remoteJid,
          remoteJidAlt,
        });
        continue;
      }

      // Stage 4: Pure transformation
      let userMessage: UserMessage;
      try {
        userMessage = this.parser.parse(raw, canonicalPnJid);
      } catch (parseError) {
        this.logger.error('Failed to parse eligible WhatsApp message', parseError);
        continue;
      }

      // Stage 5: Core use-case execution
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
   * Resolves the candidate database query address and optional paired LID from incoming stanza keys.
   *
   * WhatsApp employs dual identity representations depending on client version and device topology:
   * 1. Modern Web / Multi-Device:
   *    - `remoteJid` is a Linked Identity (`<lid>@lid`).
   *    - `remoteJidAlt` is the companion phone number (`<phone>@s.whatsapp.net`).
   *    -> Priority: Query by `remoteJidAlt` (phone number) so newly seeded users whose `lid`
   *       is still NULL in PostgreSQL match immediately on their first interaction.
   *       Cache `remoteJid` (`<lid>@lid`) as `pairedLid`.
   *
   * 2. Traditional Mobile App:
   *    - `remoteJid` is the phone number (`<phone>@s.whatsapp.net`).
   *    - `remoteJidAlt` may contain the user's LID (`<lid>@lid`) if negotiated.
   *    -> Query by `remoteJid` (phone number). Cache `remoteJidAlt` if present.
   *
   * 3. LID-Only Stanzas (Follow-up Handshakes):
   *    - `remoteJid` is `<lid>@lid`.
   *    - `remoteJidAlt` is omitted/undefined.
   *    -> Query by `remoteJid` (matches already-cached LID in PostgreSQL).
   */
  private resolveSenderAddresses(
    remoteJid: string,
    remoteJidAlt?: string
  ): { checkAddress: string; pairedLid: string | null; isLid: boolean } {
    const isLid = WhatsAppJid.isLidUser(remoteJid);
    const isAltPn = Boolean(remoteJidAlt && WhatsAppJid.isPnUser(remoteJidAlt));
    const isAltLid = Boolean(remoteJidAlt && WhatsAppJid.isLidUser(remoteJidAlt));

    // When primary is an LID and WhatsApp provided the phone number in remoteJidAlt,
    // prefer the phone number for checking the allowlist to match newly seeded users.
    const checkAddress = isLid && isAltPn ? remoteJidAlt! : remoteJid;

    // Extract whichever field contains the LID address for background caching.
    const pairedLid = isLid ? remoteJid : (isAltLid ? remoteJidAlt! : null);

    return { checkAddress, pairedLid, isLid };
  }

  /**
   * Resolves an incoming message sender identity to a canonical Phone Number JID (@s.whatsapp.net).
   *
   * Prevents split-brain conversation history in `dialogue_turns`. If a user interacts via WhatsApp Web
   * or a linked device, modern WhatsApp sends an `@lid` stanza. This method maps the ephemeral or device
   * LID back to the user's persistent phone number identity using either:
   * 1. The companion stanza attribute `remoteJidAlt` (fast in-memory path).
   * 2. The authenticated user record `user.jid` (already fetched during Stage 2 authentication).
   *
   * If the sender identity cannot be resolved to a canonical phone number, returns `null` so the caller
   * can safely drop the message rather than fragmenting conversation history under an unmapped LID.
   */
  private resolveCanonicalPnJid(
    remoteJid: string,
    remoteJidAlt: string | undefined,
    isLid: boolean,
    user: AllowedUserRecord
  ): string | null {
    // 1. Traditional phone number stanza: normalize to strip device suffixes (:1, :2)
    if (!isLid) {
      return WhatsAppJid.normalize(remoteJid);
    }

    // 2. LID stanza with companion phone number: normalize stanza alt attribute
    if (remoteJidAlt && WhatsAppJid.isPnUser(remoteJidAlt)) {
      const normalizedAlt = WhatsAppJid.normalize(remoteJidAlt);
      if (normalizedAlt) {
        return normalizedAlt;
      }
    }

    // 3. LID stanza without companion phone number: return canonical JID from authenticated user record
    if (user.jid) {
      return user.jid;
    }

    // Unresolvable identity: cannot safely map to a canonical phone number
    return null;
  }
}
