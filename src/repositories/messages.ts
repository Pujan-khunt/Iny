import { and, eq } from "drizzle-orm";
import { proto } from "@whiskeysockets/baileys";
import { db } from "../db/index.js";
import { messages } from "../db/schema.js";

export async function saveMessage(
  remoteJid: string,
  messageId: string,
  message: proto.IMessage,
): Promise<void> {
  const bytes = Buffer.from(proto.Message.encode(message).finish());

  await db
    .insert(messages)
    .values({ remoteJid, messageId, message: bytes })
    .onConflictDoNothing();
}

export async function getMessage(
  remoteJid: string,
  messageId: string,
): Promise<proto.IMessage | undefined> {
  const rows = await db
    .select({ message: messages.message })
    .from(messages)
    .where(and(eq(messages.remoteJid, remoteJid), eq(messages.messageId, messageId)));

  const row = rows[0];

  if (!row) {
    return undefined;
  }

  return proto.Message.decode(row.message);
}