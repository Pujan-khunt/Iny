import type { AnyMessageContent, MiscMessageGenerationOptions, WAMessage, WASocket } from "@whiskeysockets/baileys";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import { ALLOWED_JIDS } from "../config.js";
import type { Stores } from "../store.js";

export function safeSendMessage(
  socket: WASocket,
  jid: string,
  content: AnyMessageContent,
  options?: MiscMessageGenerationOptions,
): Promise<WAMessage | undefined> {
  if (!ALLOWED_JIDS.has(jid)) {
    throw new Error(`JID is not allowlisted: ${jid}`);
  }

  return socket.sendMessage(jid, content, options);
}

export async function replyTo(
  socket: WASocket,
  logger: ILogger,
  stores: Stores,
  jid: string,
  content: AnyMessageContent,
  options?: MiscMessageGenerationOptions,
): Promise<void> {
  const sentMsg = await safeSendMessage(socket, jid, content, options);

  if (sentMsg?.key.id) {
    stores.sentMessageIDs.add(sentMsg.key.id);
  } else {
    logger.warn("Message sent, but id not found. Unable to add it to sent messages list.");
  }
}