import { Pool } from "pg";
import { DATABASE_URL } from "./config.js";

export const pool = new Pool({
  connectionString: DATABASE_URL,
});

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      remote_jid TEXT NOT NULL,
      message_id TEXT NOT NULL,
      message    BYTEA NOT NULL,
      PRIMARY KEY (remote_jid, message_id)
    );

    CREATE TABLE IF NOT EXISTS ai_facts (
      user_jid   TEXT NOT NULL,
      fact       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_jid, fact)
    );

    CREATE TABLE IF NOT EXISTS ai_history (
      id         BIGSERIAL PRIMARY KEY,
      user_jid   TEXT NOT NULL,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS allowed_jids (
      jid        TEXT PRIMARY KEY,
      added_by   TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}