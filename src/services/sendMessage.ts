import type { AnyMessageContent, MiscMessageGenerationOptions, WAMessage, WASocket } from "@whiskeysockets/baileys";
import { ALLOWED_JIDS } from "../config.js";

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