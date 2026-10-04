/**
 * Outbound port for delivering messages to users via the transport layer (e.g. WhatsApp).
 * Core use cases rely on this port without coupling to concrete communication sockets.
 */
export interface MessageSenderPort {
  /**
   * Delivers a textual message payload to the specified recipient.
   *
   * @param userId The canonical user identifier or destination routing address.
   * @param content The text payload to transmit to the user.
   * @throws Error if delivery over the underlying transport fails.
   */
  sendMessage(userId: string, content: string): Promise<void>;
}

