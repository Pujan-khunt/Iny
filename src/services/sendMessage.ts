import type { AnyMessageContent, MiscMessageGenerationOptions, WAMessage, WASocket } from "@whiskeysockets/baileys";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import { isAllowlisted } from "../repositories/allowlist.js";
import type { Stores } from "../store.js";
import { getLogger } from "../logger.js";
import { resolveUserJid } from "./jid.js";

const logger = getLogger("send-message");

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
    logger.warn({ jid, candidates }, "Refusing to send message to non-allowlisted JID");
    return undefined;
  }

  return socket.sendMessage(jid, content, options);
}

export async function replyTo(
  socket: WASocket,
  log: ILogger,
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
    log.warn({ jid }, "Message send returned no message ID or was skipped");
  }
}