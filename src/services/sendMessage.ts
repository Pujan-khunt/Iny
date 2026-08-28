import type { AnyMessageContent, MiscMessageGenerationOptions, WAMessage, WASocket } from "@whiskeysockets/baileys";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import { isAllowlisted } from "../repositories/allowlist.js";
import type { Stores } from "../store.js";
import { resolveUserJid } from "./jid.js";

export async function safeSendMessage(
  socket: WASocket,
  jid: string,
  content: AnyMessageContent,
  options?: MiscMessageGenerationOptions,
  altJidOrAllJids?: string | string[] | null,
): Promise<WAMessage | undefined> {
  const candidates: string[] = [jid];
  if (Array.isArray(altJidOrAllJids)) {
    candidates.push(...altJidOrAllJids);
  } else if (altJidOrAllJids) {
    candidates.push(altJidOrAllJids);
  }

  // Check allowlist with candidate JIDs
  let allowed = isAllowlisted(candidates);

  // If not immediately recognized, try resolving JID via socket/signal store
  if (!allowed) {
    const resolved = await resolveUserJid(
      socket,
      jid,
      typeof altJidOrAllJids === "string" ? altJidOrAllJids : undefined,
    );
    allowed = isAllowlisted(resolved.allJids);
  }

  if (!allowed) {
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
  altJidOrAllJids?: string | string[] | null,
): Promise<void> {
  const sentMsg = await safeSendMessage(socket, jid, content, options, altJidOrAllJids);

  if (sentMsg?.key.id) {
    stores.sentMessageIDs.add(sentMsg.key.id);
  } else {
    logger.warn("Message sent, but id not found. Unable to add it to sent messages list.");
  }
}