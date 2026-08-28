import {
  isJidGroup,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  proto,
  type WASocket,
} from "@whiskeysockets/baileys";

export interface JidInfo {
  /** The raw remoteJid from the message key */
  remoteJid: string;
  /** Normalized remoteJid without device suffixes */
  normalizedRemoteJid: string;
  /** Resolved Phone Number JID if available (@s.whatsapp.net) */
  pnJid?: string | undefined;
  /** Resolved Linked Identity JID if available (@lid) */
  lidJid?: string | undefined;
  /** Group participant JID (if in group) */
  participantJid?: string | undefined;
  /** Group participant PN JID (if in group) */
  participantPnJid?: string | undefined;
  /** Canonical JID used for state tracking, rate limiting, and cache */
  canonicalJid: string;
  /** All candidate JIDs representing this sender / chat for allowlist and admin checks */
  allJids: string[];
  /** Whether the message is from a group */
  isGroup: boolean;
}

// In-memory bidirectional cache for fast synchronous & asynchronous lookups
const pnToLidCache = new Map<string, string>();
const lidToPnCache = new Map<string, string>();

/**
 * Normalizes a JID by removing device suffixes and standardizing domains.
 */
export function normalizeJid(jid?: string | null): string {
  if (!jid) return "";
  return jidNormalizedUser(jid);
}

/**
 * Cache a bidirectional mapping between a Phone Number JID and a Linked Identity JID.
 */
export function cacheJidMapping(pn: string, lid: string): void {
  const normPn = normalizeJid(pn);
  const normLid = normalizeJid(lid);
  if (normPn && normLid && normPn !== normLid) {
    pnToLidCache.set(normPn, normLid);
    lidToPnCache.set(normLid, normPn);
  }
}

/**
 * Get the cached Phone Number JID for a given LID JID.
 */
export function getCachedPnForLid(lid: string): string | undefined {
  return lidToPnCache.get(normalizeJid(lid));
}

/**
 * Get the cached LID JID for a given Phone Number JID.
 */
export function getCachedLidForPn(pn: string): string | undefined {
  return pnToLidCache.get(normalizeJid(pn));
}

/**
 * Invalidate a cached mapping for a JID.
 */
export function invalidateJidMapping(jid: string): void {
  const normalized = normalizeJid(jid);
  const lid = pnToLidCache.get(normalized);
  if (lid) {
    lidToPnCache.delete(lid);
    pnToLidCache.delete(normalized);
  }
  const pn = lidToPnCache.get(normalized);
  if (pn) {
    pnToLidCache.delete(pn);
    lidToPnCache.delete(normalized);
  }
}

/**
 * Resolves a single user JID (whether PN or LID) to both its PN and LID forms.
 */
export async function resolveUserJid(
  socket: WASocket,
  jid: string,
  altJid?: string | null,
): Promise<{ pnJid?: string | undefined; lidJid?: string | undefined; allJids: string[] }> {
  const normalized = normalizeJid(jid);
  if (!normalized) {
    return { allJids: [] };
  }

  let pnJid: string | undefined;
  let lidJid: string | undefined;

  const normalizedAlt = normalizeJid(altJid);

  if (isLidUser(normalized)) {
    lidJid = normalized;
    if (normalizedAlt && isPnUser(normalizedAlt)) {
      pnJid = normalizedAlt;
      cacheJidMapping(pnJid, lidJid);
    } else {
      const cachedPn = getCachedPnForLid(lidJid);
      if (cachedPn) {
        pnJid = cachedPn;
      } else {
        try {
          const resolved = await socket.signalRepository?.lidMapping?.getPNForLID(jid);
          if (resolved) {
            pnJid = normalizeJid(resolved);
            cacheJidMapping(pnJid, lidJid);
          }
        } catch {
          // ignore lookup failure
        }
      }
    }
  } else if (isPnUser(normalized)) {
    pnJid = normalized;
    if (normalizedAlt && isLidUser(normalizedAlt)) {
      lidJid = normalizedAlt;
      cacheJidMapping(pnJid, lidJid);
    } else {
      const cachedLid = getCachedLidForPn(pnJid);
      if (cachedLid) {
        lidJid = cachedLid;
      } else {
        try {
          const resolved = await socket.signalRepository?.lidMapping?.getLIDForPN(jid);
          if (resolved) {
            lidJid = normalizeJid(resolved);
            cacheJidMapping(pnJid, lidJid);
          }
        } catch {
          // ignore lookup failure
        }
      }
    }
  }

  const allJids: string[] = Array.from(
    new Set(
      [jid, normalized, altJid, normalizedAlt, pnJid, lidJid].filter(
        (j): j is string => typeof j === "string" && j.length > 0,
      ),
    ),
  );

  return { pnJid, lidJid, allJids };
}

/**
 * Resolves all JID representations for an incoming WhatsApp message.
 */
export async function resolveMessageJids(
  socket: WASocket,
  msg: proto.IWebMessageInfo,
): Promise<JidInfo> {
  const remoteJid = msg.key?.remoteJid || "";
  const normalizedRemoteJid = normalizeJid(remoteJid);
  const altJid = (msg.key as any)?.remoteJidAlt as string | undefined;
  const isGroup = isJidGroup(remoteJid);

  if (isGroup) {
    const participant = msg.key?.participant || "";
    const participantAlt = (msg.key as any)?.participantAlt as string | undefined;

    let participantPnJid: string | undefined;
    let participantLid: string | undefined;
    let participantAllJids: string[] = [];

    if (participant) {
      const resolvedParticipant = await resolveUserJid(socket, participant, participantAlt);
      participantPnJid = resolvedParticipant.pnJid;
      participantLid = resolvedParticipant.lidJid;
      participantAllJids = resolvedParticipant.allJids;
    }

    const allJids: string[] = Array.from(
      new Set(
        [remoteJid, normalizedRemoteJid, altJid, normalizeJid(altJid), ...participantAllJids].filter(
          (j): j is string => typeof j === "string" && j.length > 0,
        ),
      ),
    );

    return {
      remoteJid,
      normalizedRemoteJid,
      participantJid: normalizeJid(participant) || undefined,
      participantPnJid,
      lidJid: participantLid,
      canonicalJid: normalizedRemoteJid,
      allJids,
      isGroup: true,
    };
  }

  const resolved = await resolveUserJid(socket, remoteJid, altJid);
  const canonicalJid = resolved.pnJid || resolved.lidJid || normalizedRemoteJid;

  return {
    remoteJid,
    normalizedRemoteJid,
    pnJid: resolved.pnJid,
    lidJid: resolved.lidJid,
    canonicalJid,
    allJids: resolved.allJids,
    isGroup: false,
  };
}
