import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal"
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";


async function connectToWhatsapp() {
  // Saves cryptographic credentials in the provided directory.
  // Make sure to add this directory to exclude this directory from the VCS.
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys")

  const socket = makeWASocket({
    auth: state
  })

  socket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) qrcode.generate(qr, { small: true })
    if (connection === "close") {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
      console.log("connection closed due to", lastDisconnect?.error, ", reconnecting:", shouldReconnect)
      if (shouldReconnect) {
        connectToWhatsapp()
      }
    } else if (connection === "open") {
      console.log("opened connection")
    }
  })

  socket.ev.on("messages.upsert", async (event) => {
    if (event.type !== "notify") return;
    for (const message of event.messages) {
      if (message.key.fromMe) continue
      console.log(JSON.stringify(message, undefined, 2))

      console.log("replying to", message.key.remoteJid)
      await socket.sendMessage(message.key.remoteJid!, { text: "Hello from Baileys!" })
    }
  })

  socket.ev.on("creds.update", saveCreds)
}

connectToWhatsapp()
