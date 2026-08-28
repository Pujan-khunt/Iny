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
import { normalizeJid, resolveMessageJids, type JidInfo } from "../services/jid.js";
import { isAdmin } from "../services/admin.js";

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
  resolvedJidInfo?: JidInfo,
): Promise<void> {
  if (!msg.key) return;
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid) return;

  const isBotReply = msg.key.id && stores.sentMessageIDs.has(msg.key.id);
  if (isBotReply) return;

  const text = getMessageText(msg.message);
  if (!text) return;

  const jidInfo = resolvedJidInfo ?? (await resolveMessageJids(socket, msg));
  const isGroup = jidInfo.isGroup;

  // Check bot mention supporting both PN and LID forms
  const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
  const botPn = normalizeJid(socket.user?.id || botJid);
  const botLid = normalizeJid((socket.user as any)?.lid || (socket.authState?.creds?.me as any)?.lid);
  const isMention = mentionedJids.some((m) => {
    const norm = normalizeJid(m);
    return (
      (botPn && norm === botPn) ||
      (botLid && norm === botLid) ||
      (botJid && norm === normalizeJid(botJid))
    );
  });

  const isReply =
    msg.message?.extendedTextMessage?.contextInfo?.stanzaId &&
    stores.sentMessageIDs.has(msg.message?.extendedTextMessage?.contextInfo?.stanzaId);
  const isDM = !isGroup;

  // Allow DMs, mentions, and replies - don't ignore DMs!
  // Only ignore group messages that aren't mentions or replies
  if (isGroup && !isMention && !isReply) {
    return;
  }

  if (!isAllowlisted(jidInfo.allJids)) {
    logger.warn({ remoteJid, allJids: jidInfo.allJids }, "Ignored non-allowlisted message");
    return;
  }

  const rateLimitKey = jidInfo.canonicalJid;
  const rateLimiter = isDM ? DM_RATE_LIMITER : (isMention ? MENTION_RATE_LIMITER : REPLY_RATE_LIMITER);
  if (!rateLimiter.check(rateLimitKey)) {
    logger.warn(`Rate limited user: ${rateLimitKey}`);
    return;
  }

  const ctx = {
    socket,
    logger,
    stores,
    msg: msg as any,
    jid: remoteJid,
    altJid: (msg.key as any).remoteJidAlt,
    allJids: jidInfo.allJids,
    jidInfo,
    text: text.trim(),
    isGroup,
    isMention,
    isReply: !!isReply,
    isDM,
    reply: (content: any, options?: any) =>
      replyTo(socket, logger, stores, remoteJid, content, options, jidInfo.allJids),
  };

  // Check for commands first (works in DMs and groups)
  const parsed = parseCommand(text.trim());
  if (parsed) {
    const command = commandRegistry.get(parsed.name);
    if (command) {
      if (!COMMAND_RATE_LIMITER.check(rateLimitKey)) {
        logger.warn(`Command rate limited user: ${rateLimitKey}`);
        return;
      }
      if (command.adminOnly) {
        if (!isAdmin(jidInfo.allJids)) {
          await ctx.reply({ text: "You don't have permission to run this command." });
          return;
        }
      }
      // Create CommandContext for the command
      const commandCtx = {
        socket,
        logger,
        stores,
        registry: commandRegistry,
        msg: msg as any,
        jid: remoteJid,
        altJid: (msg.key as any).remoteJidAlt,
        allJids: jidInfo.allJids,
        jidInfo,
        name: parsed.name,
        args: parsed.args,
        text: parsed.text,
        reply: (content: any, options?: any) =>
          replyTo(socket, logger, stores, remoteJid, content, options, jidInfo.allJids),
      };
      await command.execute(commandCtx);
      return;
    }
  }

  // Check if user is asking for sources in a reply
  if (isReply && isAskingForSources(text)) {
    const cached = getSourcesForUser(jidInfo.canonicalJid);
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
    const answer = await runAgent(text.trim(), jidInfo.canonicalJid);
    await ctx.reply({ text: answer });
  } catch (error) {
    logger.error({ error }, "Agent handling failed");
    await ctx.reply({ text: FALLBACK_MESSAGE });
  }
}
