import { pool } from "../db.js";

export interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

export async function rememberFact(userJid: string, fact: string): Promise<void> {
  await pool.query(
    `INSERT INTO ai_facts (user_jid, fact)
     VALUES ($1, $2)
     ON CONFLICT (user_jid, fact) DO NOTHING`,
    [userJid, fact],
  );
}

export async function listFacts(userJid: string): Promise<string[]> {
  const result = await pool.query<{ fact: string }>(
    `SELECT fact FROM ai_facts WHERE user_jid = $1 ORDER BY created_at DESC`,
    [userJid],
  );

  return result.rows.map((row) => row.fact);
}

export async function forgetFact(userJid: string, fact: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM ai_facts WHERE user_jid = $1 AND fact = $2`,
    [userJid, fact],
  );

  return result.rowCount !== null && result.rowCount > 0;
}

export async function addHistory(userJid: string, role: HistoryEntry["role"], content: string): Promise<void> {
  await pool.query(
    `INSERT INTO ai_history (user_jid, role, content) VALUES ($1, $2, $3)`,
    [userJid, role, content],
  );
}

export async function getHistory(userJid: string, limit = 10): Promise<HistoryEntry[]> {
  const result = await pool.query<{ role: HistoryEntry["role"]; content: string }>(
    `SELECT role, content FROM ai_history
     WHERE user_jid = $1
     ORDER BY id DESC
     LIMIT $2`,
    [userJid, limit],
  );

  return result.rows.reverse();
}