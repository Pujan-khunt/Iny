export const AUTH_DIR = "auth_info_baileys";

export const ALLOWED_JIDS = new Set<string>(
  (process.env.ALLOWED_JIDS ?? "")
    .split(",")
    .map((jid) => jid.trim())
    .filter(Boolean),
);