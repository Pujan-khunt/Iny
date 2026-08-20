import type { WASocket } from "@whiskeysockets/baileys";
import type { Stores } from "../store.js";

export function registerGroupHandlers(
  socket: WASocket,
  stores: Stores,
) {
  socket.ev.on('groups.update', async (events) => {
    for (const event of events) {
      if (event?.id) {
        stores.groupCache.set(event.id, await socket.groupMetadata(event.id))
      }
    }
  })

  socket.ev.on('group-participants.update', async (event) => {
    stores.groupCache.set(event.id, await socket.groupMetadata(event.id))
  })
}