import type { proto, WASocket } from "@whiskeysockets/baileys";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import { safeSendMessage } from "./sendMessage.js";
import type { Stores } from "../store.js";
import { getLogger } from "../logger.js";
import { PROCESSING_REACTION_EMOJI, TYPING_HEARTBEAT_INTERVAL_MS } from "../config.js";

const defaultLogger = getLogger("chat-ux");

/**
 * Marks an incoming message as read (blue ticks).
 */
export async function markAsRead(
  socket: WASocket,
  key: proto.IMessageKey,
  log: ILogger = defaultLogger,
): Promise<void> {
  try {
    await socket.readMessages([key]);
  } catch (error) {
    log.debug({ error, key }, "Failed to mark message as read");
  }
}

/**
 * Sets or removes a reaction emoji on a message.
 * Passing an empty string ("") removes any existing reaction.
 */
export async function setReaction(
  socket: WASocket,
  stores: Stores,
  jid: string,
  key: proto.IMessageKey,
  emoji: string,
  altJidOrAllJids?: string | string[] | null,
  log: ILogger = defaultLogger,
): Promise<void> {
  try {
    const sentMsg = await safeSendMessage(
      socket,
      jid,
      {
        react: {
          text: emoji,
          key,
        },
      },
      undefined,
      altJidOrAllJids,
    );
    if (sentMsg?.key?.id) {
      stores.sentMessageIDs.add(sentMsg.key.id);
    }
  } catch (error) {
    log.debug({ error, jid, emoji }, "Failed to set reaction");
  }
}

/**
 * Keeps the typing indicator ("composing") alive with a recurring heartbeat.
 * Returns a stop function that clears the interval and pauses typing presence.
 */
export function startTypingHeartbeat(
  socket: WASocket,
  jid: string,
  log: ILogger = defaultLogger,
  intervalMs = TYPING_HEARTBEAT_INTERVAL_MS,
): () => void {
  let stopped = false;

  const sendTyping = () => {
    if (stopped) return;
    try {
      socket.sendPresenceUpdate("composing", jid)?.catch((error) => {
        log.debug({ error, jid }, "Failed to send composing presence");
      });
    } catch (error) {
      log.debug({ error, jid }, "Failed to initiate composing presence");
    }
  };

  sendTyping();
  const interval = setInterval(sendTyping, intervalMs);

  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    try {
      socket.sendPresenceUpdate("paused", jid)?.catch((error) => {
        log.debug({ error, jid }, "Failed to send paused presence");
      });
    } catch (error) {
      log.debug({ error, jid }, "Failed to initiate paused presence");
    }
  };
}

/**
 * Wraps an async task (like RAG query generation and response sending) with:
 * 1. An initial processing emoji reaction (e.g. ⏳)
 * 2. An active typing indicator heartbeat
 * 3. Guaranteed cleanup in finally (stops heartbeat, removes reaction)
 */
export async function withProgressUx<T>(
  socket: WASocket,
  stores: Stores,
  jid: string,
  key: proto.IMessageKey | undefined | null,
  allJids: string | string[] | null | undefined,
  log: ILogger = defaultLogger,
  action: () => Promise<T>,
  options?: { reactionEmoji?: string; typingIntervalMs?: number },
): Promise<T> {
  const emoji = options?.reactionEmoji ?? PROCESSING_REACTION_EMOJI;
  const hasKey = Boolean(key?.id && key?.remoteJid);

  if (hasKey && key) {
    await setReaction(socket, stores, jid, key, emoji, allJids, log);
  }
  const stopTyping = startTypingHeartbeat(socket, jid, log, options?.typingIntervalMs);

  try {
    return await action();
  } finally {
    stopTyping();
    if (hasKey && key) {
      await setReaction(socket, stores, jid, key, "", allJids, log);
    }
  }
}
