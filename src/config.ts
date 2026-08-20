export const AUTH_DIR = "auth_info_baileys";

export const DATABASE_URL = process.env.DATABASE_URL;

export const AI_API_KEY = process.env.AI_API_KEY;

export const AI_MODEL = process.env.AI_MODEL ?? "gpt-4o-mini";

export const AI_BASE_URL = process.env.AI_BASE_URL;

export const AI_SITE_URL = process.env.AI_SITE_URL;

export const AI_SITE_NAME = process.env.AI_SITE_NAME;

export const ALLOWED_JIDS = new Set<string>(
  (process.env.ALLOWED_JIDS ?? "")
    .split(",")
    .map((jid) => jid.trim())
    .filter(Boolean),
);