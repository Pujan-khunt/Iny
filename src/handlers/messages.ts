import { type WASocket } from "@whiskeysockets/baileys";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import { getMessageText } from "../utils/messageText.js";
import { isAllowlisted } from "../repositories/allowlist.js";
import { saveMessage } from "../repositories/messages.js";
import { handleNaturalMessage } from "./natural.js";
import { createCommands } from "../commands/index.js";
import type { CommandRegistry } from "../commands/registry.js";
import type { Stores } from "../store.js";

export function registerMessageHandlers(
  socket: WASocket,
  logger: ILogger,
  stores: Stores,
  botJid: string,
) {
  const commandRegistry: CommandRegistry = createCommands();

  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      if (msg.key.id && msg.message && msg.key.remoteJid) {
        try {
          await saveMessage(msg.key.remoteJid, msg.key.id, msg.message);
        } catch (error) {
          logger.error({ error }, "Failed to persist message");
        }
      }

      logger.info({ msg });

      const remoteJid = msg.key.remoteJid!;
      const isBotReply = stores.sentMessageIDs.has(msg.key.id!);

      if (isBotReply || type !== "notify") {
        continue;
      }

      const altJid = msg.key.remoteJidAlt;

      if (!isAllowlisted(remoteJid, altJid)) {
        logger.warn({ remoteJid, remoteJidAlt: altJid }, "Ignored non-allowlisted message");
        continue;
      }

      const text = getMessageText(msg.message);

      if (!text) {
        continue;
      }

      await handleNaturalMessage(socket, logger, stores, msg, botJid, commandRegistry);
    }
  });
}
