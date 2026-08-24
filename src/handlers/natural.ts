import { isJidGroup, proto, type WASocket } from "@whiskeysockets/baileys";
import { extractMessageContent, getContentType } from "@whiskeysockets/baileys";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import type { Stores } from "../store.js";
import { askWithContext } from "../rag/answer.js";
import { isAllowlisted } from "../repositories/allowlist.js";
import { replyTo } from "../services/sendMessage.js";
import { createRateLimiter } from "../services/rateLimit.js";
import { WELCOME_TRIGGER_PATTERN, WELCOME_MESSAGE, FALLBACK_MESSAGE } from "../config.js";
import { createCommands } from "../commands/index.js";
import type { CommandRegistry } from "../commands/registry.js";
import type { CommandContext } from "../commands/types.js";

const MENTION_RATE_LIMITER = createRateLimiter(10, 60_000);
const REPLY_RATE_LIMITER = createRateLimiter(10, 60_000);
const DM_RATE_LIMITER = createRateLimiter(20, 60_000);
const COMMAND_RATE_LIMITER = createRateLimiter(15, 60_000);

const welcomeRegex = new RegExp(WELCOME_TRIGGER_PATTERN, "i");

function getMessageText(message: proto.IMessage | null | undefined): string | undefined {
  if (!message) return undefined;
  const content = extractMessageContent(message);
  const type = getContentType(content);
  if (type === "conversation") return content?.conversation ?? undefined;
  if (type === "extendedTextMessage") return content?.extendedTextMessage?.text ?? undefined;
  return undefined;
}

function getRateLimiter(isDM: boolean, isMention: boolean, isReply: boolean) {
  if (isDM) return DM_RATE_LIMITER;
  if (isMention) return MENTION_RATE_LIMITER;
  if (isReply) return REPLY_RATE_LIMITER;
  return DM_RATE_LIMITER;
}

function parseCommand(text: string): { name: string; args: string[]; text: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const parts = trimmed.slice(1).split(/\s+/);
  return { name: parts[0]?.toLowerCase() ?? "", args: parts.slice(1), text: trimmed };
}

export async function handleNaturalMessage(
  socket: WASocket,
  logger: ILogger,
  stores: Stores,
  msg: proto.IWebMessageInfo,
  botJid: string,
  sentMessageIDs: Set<string>,
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

  const jid = remoteJid;
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

  // Handle welcome trigger
  const isWelcomeTrigger = !isGroup && welcomeRegex.test(text.trim().toLowerCase());
  if (isWelcomeTrigger) {
    await ctx.reply({ text: WELCOME_MESSAGE });
    return;
  }

  // RAG for all other messages
  try {
    const answer = await askWithContext(text.trim());
    await ctx.reply({ text: answer });
  } catch (error) {
    logger.error({ error }, "Natural message handling failed");
    await ctx.reply({ text: FALLBACK_MESSAGE });
  }
}