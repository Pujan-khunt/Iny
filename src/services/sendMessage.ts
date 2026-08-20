import type { AnyMessageContent, MiscMessageGenerationOptions, WAMessage, WASocket } from "@whiskeysockets/baileys";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import { isAllowlisted } from "../repositories/allowlist.js";
import type { Stores } from "../store.js";

export function safeSendMessage(
  socket: WASocket,
  jid: string,
  content: AnyMessageContent,
  options?: MiscMessageGenerationOptions,
  altJid?: string | null,
): Promise<WAMessage | undefined> {
  if (!isAllowlisted(jid, altJid)) {
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
  altJid?: string | null,
): Promise<void> {
  const sentMsg = await safeSendMessage(socket, jid, content, options, altJid);

  if (sentMsg?.key.id) {
    stores.sentMessageIDs.add(sentMsg.key.id);
  } else {
    logger.warn("Message sent, but id not found. Unable to add it to sent messages list.");
  }
}