import { extractMessageContent, getContentType, proto } from "@whiskeysockets/baileys";

/**
 * Extract plain text content from a Baileys WhatsApp message proto.
 * Supports standard conversation messages and extended text messages.
 */
export function getMessageText(message: proto.IMessage | null | undefined): string | undefined {
  if (!message) {
    return undefined;
  }

  const content = extractMessageContent(message);
  const type = getContentType(content);

  if (type === "conversation") {
    return content?.conversation ?? undefined;
  }

  if (type === "extendedTextMessage") {
    return content?.extendedTextMessage?.text ?? undefined;
  }

  return undefined;
}