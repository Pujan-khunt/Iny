import { ADMIN_JIDS } from "../config.js";

export function isAdmin(jid: string, altJid?: string | null): boolean {
  if (ADMIN_JIDS.has(jid)) {
    return true;
  }

  return !!altJid && ADMIN_JIDS.has(altJid);
}
