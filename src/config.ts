export const AUTH_DIR = "auth_info_baileys";

export const DATABASE_URL = process.env.DATABASE_URL;

export const AI_API_KEY = process.env.AI_API_KEY;

export const AI_MODEL = process.env.AI_MODEL ?? "gpt-4o-mini";

export const AI_BASE_URL = process.env.AI_BASE_URL;

export const AI_SITE_URL = process.env.AI_SITE_URL;

export const AI_SITE_NAME = process.env.AI_SITE_NAME;

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";

export const SIMILARITY_THRESHOLD = Number(process.env.SIMILARITY_THRESHOLD ?? 0.35);

export const TOP_K = Number(process.env.TOP_K ?? 5);

export const MAX_CONTEXT_TOKENS = Number(process.env.MAX_CONTEXT_TOKENS ?? 2000);

export const WELCOME_TRIGGER_PATTERN = process.env.WELCOME_TRIGGER_PATTERN ?? "^(iny|hi iny)$";

export const FALLBACK_MESSAGE = process.env.FALLBACK_MESSAGE ?? "Couldn't find that in the database. Try rephrasing?";

export const WELCOME_MESSAGE = process.env.WELCOME_MESSAGE ?? "Hi! I'm Iny, your assistant. Ask me anything related to SST.";

export const ADMIN_JIDS = new Set<string>(
  (process.env.ADMIN_JIDS ?? "")
    .split(",")
    .map((jid) => jid.trim())
    .filter(Boolean),
);

export const COUNTRY_CODE = process.env.COUNTRY_CODE ?? "";

export const ALLOWED_JIDS = new Set<string>(
  (process.env.ALLOWED_JIDS ?? "")
    .split(",")
    .map((jid) => jid.trim())
    .filter(Boolean),
);
