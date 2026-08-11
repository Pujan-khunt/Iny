import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal"
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, isJidBroadcast, isJidNewsletter, makeCacheableSignalKeyStore, proto, useMultiFileAuthState, type CacheStore } from "@whiskeysockets/baileys";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import pino from "pino";
import NodeCache from "@cacheable/node-cache";

const baseLogger = pino();
const msgRetryCounterCache = new NodeCache() as CacheStore;
const groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false }) as CacheStore;
const messageStore = new Map<string, proto.IMessage>();

async function startSock(logger: ILogger) {
  // Saves cryptographic credentials in the provided directory.
  // Exclude this directory from the VCS.
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys")
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
    msgRetryCounterCache,
    maxMsgRetryCount: 5,
    connectTimeoutMs: 20_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 30_000,
    shouldIgnoreJid: (jid) => isJidBroadcast(jid) || isJidNewsletter(jid),
    getMessage: async (key) => {
      const id = `${key.remoteJid}:${key.id}`
      return messageStore.get(id)
    },
    cachedGroupMetadata: async (jid) => groupCache.get(jid)
  })

  socket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update

    // Generate QR code if update message provides it.
    if (qr) qrcode.generate(qr, { small: true })

    // Connection can either be closed manually (on logout), or
    // every time a connection is established, the server closes the connection to restablish
    // it with all credentials, shouldReconnect handles this case.
    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      if (shouldReconnect) {
        startSock(logger)
      } else {
        logger.info("Logged Out. Delete the auth folder and re-scan to connect.")
      }
    } else if (connection === "open") {
      logger.info("connection to WhatsApp successful")
    }
  })

  socket.ev.on("creds.update", saveCreds)

  socket.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
      if (msg.key.id && msg.message) {
        messageStore.set(`${msg.key.remoteJid}:${msg.key.id}`, msg.message)
      }
    }
  })

  socket.ev.on('groups.update', async (events) => {
    for (const event of events) {
      if (event?.id) {
        groupCache.set(event.id, await socket.groupMetadata(event.id))
      }
    }
  })

  socket.ev.on('group-participants.update', async (event) => {
    groupCache.set(event.id, await socket.groupMetadata(event.id))
  })

  return socket
}

const socketLogger = baseLogger.child({ class: "baileys" });
startSock(socketLogger);
