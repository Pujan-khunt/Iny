import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import { DisconnectReason, type WASocket } from "@whiskeysockets/baileys";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";

export function registerConnectionHandlers(
  socket: WASocket,
  logger: ILogger,
  reconnect: () => void,
) {
  socket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update

    // Generate QR code if update event provides it.
    if (qr) qrcode.generate(qr, { small: true })

    // Connection can either be closed manually (on logout), or
    // every time a connection is established, the server closes the connection to restablish
    // it with all credentials, shouldReconnect handles this case.
    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      if (shouldReconnect) {
        reconnect()
      } else {
        logger.info("Logged Out. Delete the auth folder and re-scan to connect.")
      }
    } else if (connection === "open") {
      logger.info("connection to WhatsApp successful")
    }
  })
}