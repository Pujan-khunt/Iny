import makeWASocket, { Browsers, fetchLatestBaileysVersion, isJidBroadcast, isJidNewsletter, isJidGroup, makeCacheableSignalKeyStore, type WASocket } from "@whiskeysockets/baileys";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import { registerConnectionHandlers } from "./handlers/connection.js";
import { registerGroupHandlers } from "./handlers/groups.js";
import { registerMessageHandlers } from "./handlers/messages.js";
import { getMessage as getMessageFromDb } from "./repositories/messages.js";
import { useDbAuthState } from "./repositories/authState.js";
import type { Stores } from "./store.js";

export async function startSock(logger: ILogger, stores: Stores): Promise<WASocket> {
  const { state, saveCreds } = await useDbAuthState();
  const { version } = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    browser: Browsers.macOS("Chrome"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
    msgRetryCounterCache: stores.msgRetryCounterCache,
    maxMsgRetryCount: 5,
    connectTimeoutMs: 20_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 30_000,
    shouldIgnoreJid: (jid) => isJidBroadcast(jid) || isJidNewsletter(jid),
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
    cachedGroupMetadata: async (jid) => stores.groupCache.get(jid)
  })

  socket.ev.on("creds.update", saveCreds)

  registerConnectionHandlers(socket, logger, () => {
    void startSock(logger, stores)
  })

  const botJid = socket.user?.id ?? "";
  logger.info({ botJid });

  registerMessageHandlers(socket, logger, stores, botJid)
  registerGroupHandlers(socket, stores)

  return socket
}
