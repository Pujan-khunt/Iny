import { ALLOWED_JIDS } from "../config.js";
import { pool } from "../db.js";

// Write through cache (db and cache are synced together) for storing allowed JIDs.
const cache = new Set<string>();

export async function initAllowlist(): Promise<void> {
  const count = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM allowed_jids`);
  const existing = Number(count.rows[0]?.count ?? 0);

  if (existing === 0) {
    for (const jid of ALLOWED_JIDS) {
      await pool.query(
        `INSERT INTO allowed_jids (jid, added_by) VALUES ($1, $2) ON CONFLICT (jid) DO NOTHING`,
        [jid, "bootstrap"],
      );
    }
  }

  const result = await pool.query<{ jid: string }>(`SELECT jid FROM allowed_jids`);
  cache.clear();

  for (const row of result.rows) {
    cache.add(row.jid);
  }
}

export function isAllowlisted(jid: string, altJid?: string | null): boolean {
  if (cache.has(jid)) {
    return true;
  }

  if (altJid && cache.has(altJid)) {
    return true;
  }

  return false;
}

export async function addToAllowlist(jid: string, addedBy: string): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO allowed_jids (jid, added_by) VALUES ($1, $2) ON CONFLICT (jid) DO NOTHING`,
    [jid, addedBy],
  );

  const added = result.rowCount !== null && result.rowCount > 0;
  cache.add(jid);
  return added;
}

export async function removeFromAllowlist(jid: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM allowed_jids WHERE jid = $1`, [jid]);
  cache.delete(jid);
  return result.rowCount !== null && result.rowCount > 0;
}

export async function listAllowlist(): Promise<string[]> {
  const result = await pool.query<{ jid: string }>(
    `SELECT jid FROM allowed_jids ORDER BY created_at ASC`,
  );

  return result.rows.map((row) => row.jid);
}
