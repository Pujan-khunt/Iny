import makeWASocket, { Browsers, fetchLatestBaileysVersion, isJidBroadcast, isJidNewsletter, makeCacheableSignalKeyStore, useMultiFileAuthState, type WASocket } from "@whiskeysockets/baileys";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import { createCommands } from "./commands/index.js";
import { AUTH_DIR } from "./config.js";
import { registerConnectionHandlers } from "./handlers/connection.js";
import { registerGroupHandlers } from "./handlers/groups.js";
import { registerMessageHandlers } from "./handlers/messages.js";
import { getMessage as getMessageFromDb } from "./repositories/messages.js";
import type { Stores } from "./store.js";

export async function startSock(logger: ILogger, stores: Stores): Promise<WASocket> {
  // Saves cryptographic credentials in the provided directory.
  // Exclude this directory from the VCS.
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      // When storing auth on disk, every single Signal key lookup leads to a disk hit.
      // To minimize disk IO, this in-memory cache is introduced.
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    browser: Browsers.macOS("Chrome"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
    // In-memory cache to store per-user retry counts of failed messages.
    msgRetryCounterCache: stores.msgRetryCounterCache,
    maxMsgRetryCount: 5,
    connectTimeoutMs: 20_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 30_000,
    // Firewall against specific kinds of messages.
    shouldIgnoreJid: (jid) => isJidBroadcast(jid) || isJidNewsletter(jid),
    // Way for baileys to retrieve messages for retrying.
    getMessage: async (key) => {
      if (!key.remoteJid || !key.id) {
        return undefined;
      }

      try {
        return await getMessageFromDb(key.remoteJid, key.id)
      } catch (error) {
        logger.error({ error, key }, "getMessage lookup failed")
        return undefined
      }
    },
    // In-memory cache for storing group metadata mainly for fetching
    // participants of a WA group to distribute Sender keys for encryption, so
    // only group participants can decrypt it.
    cachedGroupMetadata: async (jid) => stores.groupCache.get(jid)
  })

  socket.ev.on("creds.update", saveCreds)

  registerConnectionHandlers(socket, logger, () => {
    void startSock(logger, stores)
  })
  registerMessageHandlers(socket, logger, stores, createCommands())
  registerGroupHandlers(socket, stores)

  return socket
}
