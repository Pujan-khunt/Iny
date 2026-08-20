import { proto } from "@whiskeysockets/baileys";
import { pool } from "../db.js";

export async function saveMessage(
  remoteJid: string,
  messageId: string,
  message: proto.IMessage,
): Promise<void> {
  const bytes = Buffer.from(proto.Message.encode(message).finish());

  await pool.query(
    `INSERT INTO messages (remote_jid, message_id, message)
     VALUES ($1, $2, $3)
     ON CONFLICT (remote_jid, message_id) DO NOTHING`,
    [remoteJid, messageId, bytes],
  );
}

export async function getMessage(
  remoteJid: string,
  messageId: string,
): Promise<proto.IMessage | undefined> {
  const result = await pool.query<{ message: Buffer }>(
    `SELECT message FROM messages WHERE remote_jid = $1 AND message_id = $2`,
    [remoteJid, messageId],
  );

  const row = result.rows[0];

  if (!row) {
    return undefined;
  }

  return proto.Message.decode(row.message);
}