import { eq, asc } from "drizzle-orm";
import { ALLOWED_JIDS_WITH_NAMES, ALLOWLIST_CACHE_TTL_MS } from "../config.js";
import { db } from "../db/index.js";
import { allowedJids } from "../db/schema.js";

interface CacheEntry {
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function isCacheValid(jid: string): boolean {
  const entry = cache.get(jid);
  if (!entry) return false;

  if (Date.now() > entry.expiresAt) {
    cache.delete(jid);
    return false;
  }

  return true;
}

export async function initAllowlist(): Promise<void> {
  const rows = await db.select({ jid: allowedJids.jid, name: allowedJids.name }).from(allowedJids);

  if (rows.length === 0) {
    for (const { jid, name } of ALLOWED_JIDS_WITH_NAMES) {
      await db.insert(allowedJids).values({ jid, name, addedBy: "bootstrap" }).onConflictDoNothing();
    }
  }

  const allRows = await db.select({ jid: allowedJids.jid }).from(allowedJids);
  cache.clear();

  const expiresAt = Date.now() + ALLOWLIST_CACHE_TTL_MS;
  for (const row of allRows) {
    cache.set(row.jid, { expiresAt });
  }
}

export function isAllowlisted(jid: string, altJid?: string | null): boolean {
  if (isCacheValid(jid)) {
    return true;
  }

  if (altJid && isCacheValid(altJid)) {
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
  const expiresAt = Date.now() + ALLOWLIST_CACHE_TTL_MS;
  cache.set(jid, { expiresAt });
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

function generateDefaultName(existingNames: string[]): string {
  // Count how many "default user N" entries exist
  const defaultCount = existingNames.filter((name) =>
    /^default user \d+$/.test(name)
  ).length;
  return `default user ${defaultCount + 1}`;
}
