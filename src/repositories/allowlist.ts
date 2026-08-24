import { eq, asc } from "drizzle-orm";
import { ALLOWED_JIDS } from "../config.js";
import { db } from "../db/index.js";
import { allowedJids } from "../db/schema.js";

const cache = new Set<string>();

function generateDefaultName(existingNames: string[]): string {
  // Count how many "default user N" entries exist
  const defaultCount = existingNames.filter((name) =>
    /^default user \d+$/.test(name)
  ).length;
  return `default user ${defaultCount + 1}`;
}

export async function initAllowlist(): Promise<void> {
  const rows = await db.select({ jid: allowedJids.jid, name: allowedJids.name }).from(allowedJids);

  if (rows.length === 0) {
    let index = 1;
    for (const jid of ALLOWED_JIDS) {
      const defaultName = `default user ${index}`;
      await db.insert(allowedJids).values({ jid, name: defaultName, addedBy: "bootstrap" }).onConflictDoNothing();
      index++;
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

export async function addToAllowlist(
  jid: string,
  addedBy: string,
  name?: string
): Promise<{ added: boolean; actualName: string }> {
  // If no name provided, generate default name
  let finalName = name;
  if (!finalName || finalName.trim().length === 0) {
    const allRows = await db.select({ name: allowedJids.name }).from(allowedJids);
    const existingNames = allRows.map((row) => row.name);
    finalName = generateDefaultName(existingNames);
  } else {
    finalName = finalName.trim();
  }

  const result = await db
    .insert(allowedJids)
    .values({ jid, name: finalName, addedBy })
    .onConflictDoNothing();

  const added = (result.rowCount ?? 0) > 0;
  cache.add(jid);
  return { added, actualName: finalName };
}

export async function removeFromAllowlist(jid: string): Promise<boolean> {
  const result = await db
    .delete(allowedJids)
    .where(eq(allowedJids.jid, jid));

  cache.delete(jid);
  return (result.rowCount ?? 0) > 0;
}

export interface AllowlistEntry {
  jid: string;
  name: string;
}

export async function listAllowlist(): Promise<AllowlistEntry[]> {
  const rows = await db
    .select({ jid: allowedJids.jid, name: allowedJids.name })
    .from(allowedJids)
    .orderBy(asc(allowedJids.createdAt));

  return rows;
}
