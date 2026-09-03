import { eq, asc } from "drizzle-orm";
import { ALLOWED_JIDS_WITH_NAMES } from "../config.js";
import { db } from "../db/index.js";
import { allowedJids } from "../db/schema.js";
import {
  normalizeJid,
  getCachedPnForLid,
  getCachedLidForPn,
  invalidateJidMapping,
} from "../services/jid.js";

// In-memory set of allowed JIDs, kept synchronized with DB operations
const allowedJidSet = new Set<string>();

/**
 * Directly add a JID to the in-memory allowlist cache.
 */
export function addAllowedJidToCache(jid: string): void {
  const norm = normalizeJid(jid);
  if (norm) {
    allowedJidSet.add(norm);
  }
}

export async function initAllowlist(): Promise<void> {
  for (const { jid, name } of ALLOWED_JIDS_WITH_NAMES) {
    const norm = normalizeJid(jid);
    if (norm) {
      await db.insert(allowedJids).values({ jid: norm, name, addedBy: "bootstrap" }).onConflictDoNothing();
    }
  }

  const allRows = await db.select({ jid: allowedJids.jid }).from(allowedJids);
  allowedJidSet.clear();

  for (const row of allRows) {
    const norm = normalizeJid(row.jid);
    if (norm) {
      allowedJidSet.add(norm);
    }
  }
}

/**
 * Checks if a JID or any candidate JIDs in a list are allowlisted.
 * Automatically propagates allowlist status to mapped alternate JIDs (e.g. LID <-> PN).
 */
export function isAllowlisted(
  jidOrJids: string | string[],
  altJid?: string | null,
): boolean {
  const candidates: string[] = [];

  if (Array.isArray(jidOrJids)) {
    candidates.push(...jidOrJids);
  } else if (jidOrJids) {
    candidates.push(jidOrJids);
  }

  if (altJid) {
    candidates.push(altJid);
  }

  // Expand candidates with normalized forms and cached mappings
  const expanded = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate) continue;
    expanded.add(candidate);
    const norm = normalizeJid(candidate);
    if (norm) {
      expanded.add(norm);
      const mappedPn = getCachedPnForLid(norm);
      if (mappedPn) expanded.add(mappedPn);
      const mappedLid = getCachedLidForPn(norm);
      if (mappedLid) expanded.add(mappedLid);
    }
  }

  // Check if any candidate is in the allowlist
  let matched = false;
  for (const candidate of expanded) {
    if (allowedJidSet.has(candidate)) {
      matched = true;
      break;
    }
  }

  if (matched) {
    // If matched, warm the allowlist set with all candidate representations (e.g., LID)
    for (const candidate of expanded) {
      allowedJidSet.add(candidate);
    }
    return true;
  }

  return false;
}

export async function addToAllowlist(
  jid: string,
  addedBy: string,
  name?: string,
): Promise<{ added: boolean; actualName: string }> {
  const normalizedJid = normalizeJid(jid) || jid.trim();

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
    .values({ jid: normalizedJid, name: finalName, addedBy })
    .onConflictDoNothing();

  const added = (result.rowCount ?? 0) > 0;
  allowedJidSet.add(normalizedJid);

  // If we know a mapped alternate JID, add it as well
  const mappedLid = getCachedLidForPn(normalizedJid);
  if (mappedLid) allowedJidSet.add(mappedLid);
  const mappedPn = getCachedPnForLid(normalizedJid);
  if (mappedPn) allowedJidSet.add(mappedPn);

  return { added, actualName: finalName };
}

export async function removeFromAllowlist(jid: string): Promise<boolean> {
  const normalizedJid = normalizeJid(jid) || jid.trim();

  const result = await db
    .delete(allowedJids)
    .where(eq(allowedJids.jid, normalizedJid));

  allowedJidSet.delete(normalizedJid);

  const mappedLid = getCachedLidForPn(normalizedJid);
  if (mappedLid) allowedJidSet.delete(mappedLid);
  const mappedPn = getCachedPnForLid(normalizedJid);
  if (mappedPn) allowedJidSet.delete(mappedPn);

  invalidateJidMapping(normalizedJid);

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
    /^default user \d+$/.test(name),
  ).length;
  return `default user ${defaultCount + 1}`;
}
