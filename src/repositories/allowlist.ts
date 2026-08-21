import { eq, asc } from "drizzle-orm";
import { ALLOWED_JIDS } from "../config.js";
import { db } from "../db/index.js";
import { allowedJids } from "../db/schema.js";

const cache = new Set<string>();

export async function initAllowlist(): Promise<void> {
  const rows = await db.select({ jid: allowedJids.jid }).from(allowedJids);

  if (rows.length === 0) {
    for (const jid of ALLOWED_JIDS) {
      await db.insert(allowedJids).values({ jid, addedBy: "bootstrap" }).onConflictDoNothing();
    }
  }

  const allRows = await db.select({ jid: allowedJids.jid }).from(allowedJids);
  cache.clear();

  for (const row of allRows) {
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
  const result = await db
    .insert(allowedJids)
    .values({ jid, addedBy })
    .onConflictDoNothing();

  const added = (result.rowCount ?? 0) > 0;
  cache.add(jid);
  return added;
}

export async function removeFromAllowlist(jid: string): Promise<boolean> {
  const result = await db
    .delete(allowedJids)
    .where(eq(allowedJids.jid, jid));

  cache.delete(jid);
  return (result.rowCount ?? 0) > 0;
}

export async function listAllowlist(): Promise<string[]> {
  const rows = await db
    .select({ jid: allowedJids.jid })
    .from(allowedJids)
    .orderBy(asc(allowedJids.createdAt));

  return rows.map((row) => row.jid);
}
