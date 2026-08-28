import { ADMIN_JIDS } from "../config.js";
import { normalizeJid, getCachedPnForLid, getCachedLidForPn } from "./jid.js";

// Normalize configured admin JIDs once for fast matching
const normalizedAdminJids = new Set<string>();
for (const adminJid of ADMIN_JIDS) {
  const norm = normalizeJid(adminJid) || adminJid.trim();
  if (norm) {
    normalizedAdminJids.add(norm);
  }
}

/**
 * Checks if a JID or any candidate JIDs in a list belong to an administrator.
 */
export function isAdmin(jidOrJids: string | string[], altJid?: string | null): boolean {
  const candidates: string[] = [];

  if (Array.isArray(jidOrJids)) {
    candidates.push(...jidOrJids);
  } else if (jidOrJids) {
    candidates.push(jidOrJids);
  }

  if (altJid) {
    candidates.push(altJid);
  }

  for (const candidate of candidates) {
    if (!candidate) continue;

    if (ADMIN_JIDS.has(candidate) || normalizedAdminJids.has(candidate)) {
      return true;
    }

    const norm = normalizeJid(candidate);
    if (norm && (ADMIN_JIDS.has(norm) || normalizedAdminJids.has(norm))) {
      return true;
    }

    const mappedPn = getCachedPnForLid(norm);
    if (mappedPn && (ADMIN_JIDS.has(mappedPn) || normalizedAdminJids.has(mappedPn))) {
      return true;
    }

    const mappedLid = getCachedLidForPn(norm);
    if (mappedLid && (ADMIN_JIDS.has(mappedLid) || normalizedAdminJids.has(mappedLid))) {
      return true;
    }
  }

  return false;
}
