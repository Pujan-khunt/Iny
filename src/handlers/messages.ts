import { extractMessageContent, getContentType, isJidGroup, proto, type WASocket } from "@whiskeysockets/baileys";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import { parseCommand } from "../commands/parser.js";
import type { CommandRegistry } from "../commands/registry.js";
import type { CommandContext } from "../commands/types.js";
import { isAllowlisted } from "../repositories/allowlist.js";
import { saveMessage } from "../repositories/messages.js";
import { replyTo } from "../services/sendMessage.js";
import { createRateLimiter } from "../services/rateLimit.js";
import type { Stores } from "../store.js";

const COMMAND_RATE_LIMITER = createRateLimiter(15, 60_000);

function getMessageText(message: proto.IMessage | null | undefined): string | undefined {
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

export function registerMessageHandlers(
  socket: WASocket,
  logger: ILogger,
  stores: Stores,
  registry: CommandRegistry,
) {
  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      // Persist the message to the database for retries / decryption lookups.
      if (msg.key.id && msg.message && msg.key.remoteJid) {
        try {
          await saveMessage(msg.key.remoteJid, msg.key.id, msg.message);
        } catch (error) {
          logger.error({ error }, "Failed to persist message");
        }
      }

      logger.info({ msg });

      const remoteJid = msg.key.remoteJid!;
      const isGroup = isJidGroup(remoteJid);
      const isBotReply = stores.sentMessageIDs.has(msg.key.id!);

      if (isGroup || isBotReply || type !== "notify") {
        continue;
      }

      const altJid = msg.key.remoteJidAlt;

      if (!isAllowlisted(remoteJid, altJid)) {
        logger.warn({ remoteJid, remoteJidAlt: altJid }, "Ignored non-allowlisted message");
        continue;
      }

      const jid = remoteJid;
      const text = getMessageText(msg.message);

      if (!text) {
        continue;
      }

      const parsed = parseCommand(text);

      if (!parsed) {
        continue;
      }

      const command = registry.get(parsed.name);

      if (!command) {
        logger.debug(`Unknown command: ${parsed.name}`);
        continue;
      }

      if (!COMMAND_RATE_LIMITER.check(jid)) {
        logger.warn(`Rate limited user: ${jid}`);
        continue;
      }

      const ctx: CommandContext = {
        socket,
        logger,
        stores,
        registry,
        msg,
        jid,
        altJid,
        name: parsed.name,
        args: parsed.args,
        text: parsed.text,
        reply: (content, options) => replyTo(socket, logger, stores, jid, content, options, altJid),
      };

      try {
        await command.execute(ctx);
      } catch (error) {
        logger.error({ error, command: parsed.name }, "Command execution failed");
      }
    }
  })
}
