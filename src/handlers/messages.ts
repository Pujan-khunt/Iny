import { areJidsSameUser, type WASocket } from "@whiskeysockets/baileys";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import { safeSendMessage } from "../services/sendMessage.js";
import type { Stores } from "../store.js";

export function registerMessageHandlers(
  socket: WASocket,
  logger: ILogger,
  stores: Stores,
) {
  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      // Preserve the existing cache behavior
      if (msg.key.id && msg.message) {
        stores.messageStore.set(`${msg.key.remoteJid}:${msg.key.id}`, msg.message)
      }

      logger.info({ msg });

      const isMsgMadeByMe = msg.key.fromMe && type === "notify";
      const isSelfChat = areJidsSameUser(socket.user?.id, msg.key.remoteJid!) || areJidsSameUser(socket.user?.lid, msg.key.remoteJid!);
      const isBotReply = stores.sentMessageIDs.has(msg.key.id!);

      if (!isMsgMadeByMe || !isSelfChat || isBotReply) {
        continue;
      }

      const sentMsg = await safeSendMessage(socket, msg.key.remoteJid!, { text: "testing with baileys. ignore it." });
      if (sentMsg?.key.id) {
        stores.sentMessageIDs.add(sentMsg?.key.id);
      } else {
        logger.warn("Message sent, but id not found. Unable to add it to sent messages list.");
      }
    }
  })
}