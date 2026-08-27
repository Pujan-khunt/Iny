import { isJidGroup, proto, type WASocket } from "@whiskeysockets/baileys";
import { getMessageText } from "../utils/messageText.js";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import type { Stores } from "../store.js";
import { runAgent } from "../services/agent.js";
import { isAllowlisted } from "../repositories/allowlist.js";
import { replyTo } from "../services/sendMessage.js";
import { createRateLimiter } from "../services/rateLimit.js";
import { FALLBACK_MESSAGE } from "../config.js";
import type { CommandRegistry } from "../commands/registry.js";
import { parseCommand } from "../commands/parser.js";
import { getSourcesForUser } from "../services/sourceCache.js";
import { isAskingForSources, formatSourcesForWhatsApp } from "../rag/formatSources.js";

const MENTION_RATE_LIMITER = createRateLimiter(10, 60_000);
const REPLY_RATE_LIMITER = createRateLimiter(10, 60_000);
const DM_RATE_LIMITER = createRateLimiter(20, 60_000);
const COMMAND_RATE_LIMITER = createRateLimiter(15, 60_000);

export async function handleNaturalMessage(
  socket: WASocket,
  logger: ILogger,
  stores: Stores,
  msg: proto.IWebMessageInfo,
  botJid: string,
  commandRegistry: CommandRegistry,
): Promise<void> {
  if (!msg.key) return;
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid) return;

  const isGroup = isJidGroup(remoteJid);
  const isBotReply = msg.key.id && stores.sentMessageIDs.has(msg.key.id);
  const altJid = (msg.key as any).remoteJidAlt;

  if (isBotReply) return;

  const text = getMessageText(msg.message);
  if (!text) return;

  const isMention = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.includes(botJid) ?? false;
  const isReply = msg.message?.extendedTextMessage?.contextInfo?.stanzaId
    && stores.sentMessageIDs.has(msg.message?.extendedTextMessage?.contextInfo?.stanzaId);
  const isDM = !isGroup;

  // Allow DMs, mentions, and replies - don't ignore DMs!
  // Only ignore group messages that aren't mentions or replies
  if (isGroup && !isMention && !isReply) {
    return;
  }

  if (!isAllowlisted(remoteJid, altJid)) {
    logger.warn({ remoteJid, remoteJidAlt: altJid }, "Ignored non-allowlisted message");
    return;
  }

  const rateLimiter = isDM ? DM_RATE_LIMITER : (isMention ? MENTION_RATE_LIMITER : REPLY_RATE_LIMITER);
  if (!rateLimiter.check(remoteJid)) {
    logger.warn(`Rate limited user: ${remoteJid}`);
    return;
  }

  const altJidVal = (msg.key as any).remoteJidAlt;

  const ctx = {
    socket,
    logger,
    stores,
    msg: msg as any,
    jid: remoteJid,
    altJid: altJidVal,
    text: text.trim(),
    isGroup,
    isMention: msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.includes(botJid) ?? false,
    isReply: msg.message?.extendedTextMessage?.contextInfo?.stanzaId
      && stores.sentMessageIDs.has(msg.message?.extendedTextMessage?.contextInfo?.stanzaId),
    isDM: !isGroup,
    reply: (content: any, options?: any) => replyTo(socket, logger, stores, remoteJid, content, options, altJidVal),
  };

  // Check for commands first (works in DMs and groups)
  const parsed = parseCommand(text.trim());
  if (parsed) {
    const command = commandRegistry.get(parsed.name);
    if (command) {
      if (!COMMAND_RATE_LIMITER.check(remoteJid)) {
        logger.warn(`Command rate limited user: ${remoteJid}`);
        return;
      }
      if (command.adminOnly) {
        const { isAdmin } = await import("../services/admin.js");
        if (!isAdmin(remoteJid, altJid)) {
          await ctx.reply({ text: "You don't have permission to run this command." });
          return;
        }
      }
      // Create a minimal CommandContext for the command
      const commandCtx = {
        socket,
        logger,
        stores,
        registry: commandRegistry,
        msg: msg as any,
        jid: remoteJid,
        altJid: altJidVal,
        name: parsed.name,
        args: parsed.args,
        text: parsed.text,
        reply: (content: any, options?: any) => replyTo(socket, logger, stores, remoteJid, content, options, altJidVal),
      };
      await command.execute(commandCtx);
      return;
    }
  }

  // Check if user is asking for sources in a reply
  if (isReply && isAskingForSources(text)) {
    const cached = getSourcesForUser(remoteJid);
    if (cached && cached.chunks.length > 0) {
      const sourcesText = formatSourcesForWhatsApp(cached.chunks);
      await ctx.reply({ text: sourcesText });
      return;
    } else {
      await ctx.reply({
        text: "No sources available for the previous response. This might be because the previous response didn't use any documents or the cache has expired.",
      });
      return;
    }
  }

  // Agent handles all messages: greetings, policy questions, and conversation
  try {
    const answer = await runAgent(text.trim(), remoteJid);
    await ctx.reply({ text: answer });
  } catch (error) {
    logger.error({ error }, "Agent handling failed");
    await ctx.reply({ text: FALLBACK_MESSAGE });
  }
}
