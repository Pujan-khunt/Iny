/**
 * Outbound port for transmitting conversational interactive feedback to users
 * over WhatsApp (read receipts, typing presence, and message reactions).
 */
export interface MessageFeedbackPort {
	/**
	 * Sends a read receipt for a specific incoming message to mark it read on WhatsApp.
	 *
	 * @param userId Unique identifier (JID) of the chat sender.
	 * @param messageId Unique message identifier assigned by WhatsApp.
	 */
	sendReadReceipt(userId: string, messageId: string): Promise<void>;

	/**
	 * Updates the typing presence state in a direct chat.
	 *
	 * @param userId Unique identifier (JID) of the chat recipient.
	 * @param presence Chat presence status ("composing" or "paused").
	 */
	sendTypingIndicator(userId: string, presence: "composing" | "paused"): Promise<void>;

	/**
	 * Sets or removes an emoji reaction on an incoming message.
	 *
	 * @param userId Unique identifier (JID) of the chat recipient.
	 * @param messageId Unique message identifier of the target message.
	 * @param reaction Emoji character to react with, or empty string to clear the reaction.
	 */
	sendReaction(userId: string, messageId: string, reaction: string): Promise<void>;
}
