import { proto, type WASocket } from "@whiskeysockets/baileys";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import type { Stores } from "../store.js";
import { askIny, getSessionSources } from "../core/index.js";
import { replyTo } from "../services/sendMessage.js";
import { createRateLimiter } from "../services/rateLimit.js";
import type { CommandRegistry } from "../commands/registry.js";
import { parseCommand } from "../commands/parser.js";
import { isAskingForSources, formatSourcesForWhatsApp } from "../rag/formatSources.js";
import { normalizeJid, type JidInfo } from "../services/jid.js";
import { isAdmin } from "../services/admin.js";
import { convertMarkdownToWhatsApp } from "../utils/markdown.js";
import { markAsRead, withProgressUx } from "../services/chatUx.js";

const MENTION_RATE_LIMITER = createRateLimiter(10, 60_000);
const REPLY_RATE_LIMITER = createRateLimiter(10, 60_000);
const DM_RATE_LIMITER = createRateLimiter(20, 60_000);
const COMMAND_RATE_LIMITER = createRateLimiter(15, 60_000);
const WARNING_RATE_LIMITER = createRateLimiter(1, 45_000);

const RATE_LIMIT_WARNING_MESSAGE =
  "⏳ *Slow down a bit!* You're sending messages too fast. Please wait a moment before sending another query.";
const COMMAND_RATE_LIMIT_WARNING_MESSAGE =
  "⏳ *Slow down a bit!* You're sending commands too fast. Please wait a moment.";

const GENERIC_ERROR_MESSAGE = "I'm having trouble processing your request. Please try again.";

export async function handleNaturalMessage(
  socket: WASocket,
  logger: ILogger,
  stores: Stores,
  msg: proto.IWebMessageInfo,
  botJid: string,
  commandRegistry: CommandRegistry,
  jidInfo: JidInfo,
  rawText: string,
): Promise<void> {
  const remoteJid = jidInfo.remoteJid;
  if (!remoteJid) return;

  const isGroup = jidInfo.isGroup;
  const text = rawText.trim();
  if (!text) return;

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

  // Mark incoming message as read (blue ticks) immediately
  if (msg.key?.id && msg.key?.remoteJid) {
    void markAsRead(socket, msg.key, logger);
  }

  const reply = (content: any, options?: any) => {
    let messageContent = content;
    if (isGroup && jidInfo.participantJid && typeof content === "object" && content !== null && !content.mentions) {
      messageContent = { ...content, mentions: [jidInfo.participantJid] };
    }
    return replyTo(
      socket,
      logger,
      stores,
      remoteJid,
      messageContent,
      { quoted: msg as any, ...options },
      jidInfo.allJids,
    );
  };

  // Derive rate limit key: per participant in groups, or canonicalJid in DMs
  const rateLimitKey = isGroup && jidInfo.participantJid
    ? `${jidInfo.canonicalJid}:${jidInfo.participantJid}`
    : jidInfo.canonicalJid;

  const rateLimiter = isDM ? DM_RATE_LIMITER : (isMention ? MENTION_RATE_LIMITER : REPLY_RATE_LIMITER);
  if (!rateLimiter.check(rateLimitKey)) {
    logger.warn(`Rate limited user: ${rateLimitKey}`);
    if (WARNING_RATE_LIMITER.check(rateLimitKey)) {
      await reply({ text: RATE_LIMIT_WARNING_MESSAGE });
    }
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
    text,
    isGroup,
    isMention,
    isReply: !!isReply,
    isDM,
    reply,
  };

  // Check for commands first (works in DMs and groups)
  const parsed = parseCommand(text.trim());
  if (parsed) {
    const command = commandRegistry.get(parsed.name);
    if (command) {
      if (!COMMAND_RATE_LIMITER.check(rateLimitKey)) {
        logger.warn(`Command rate limited user: ${rateLimitKey}`);
        if (WARNING_RATE_LIMITER.check(rateLimitKey)) {
          await reply({ text: COMMAND_RATE_LIMIT_WARNING_MESSAGE });
        }
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
        reply,
      };
      await command.execute(commandCtx);
      return;
    }
  }

  // Derive session key: per-participant for groups, canonicalJid for DMs
  const sessionKey = isGroup
    ? `${jidInfo.canonicalJid}:${jidInfo.participantJid || jidInfo.canonicalJid}`
    : jidInfo.canonicalJid;

  // Check if user is asking for sources in a reply
  if (isReply && isAskingForSources(text)) {
    const sources = getSessionSources(sessionKey);
    if (sources.length > 0) {
      const sourcesText = formatSourcesForWhatsApp(sources);
      await ctx.reply({ text: sourcesText });
      return;
    } else {
      await ctx.reply({
        text: "No sources available for the previous response. This might be because the previous response didn't use any documents or the cache has expired.",
      });
      return;
    }
  }

  // Query Core RAG Engine with progress UX (reaction emoji + typing indicator heartbeat)
  try {
    await withProgressUx(
      socket,
      stores,
      remoteJid,
      msg.key,
      jidInfo.allJids,
      logger,
      async () => {
        const response = await askIny({
          sessionId: sessionKey,
          message: text,
          metadata: {
            channel: "whatsapp",
            userId: jidInfo.canonicalJid,
            userName: (msg.pushName as string) ?? undefined,
          },
        });

        // Format standard Markdown to WhatsApp markup
        const formattedAnswer = convertMarkdownToWhatsApp(response.message);
        await ctx.reply({ text: formattedAnswer });
      },
    );
  } catch (error) {
    logger.error({ error }, "Agent handling failed");
    await ctx.reply({ text: GENERIC_ERROR_MESSAGE });
  }
}

