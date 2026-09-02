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

export const ADMIN_JIDS = new Set<string>(
  (process.env.ADMIN_JIDS ?? "")
    .split(",")
    .map((jid) => jid.trim())
    .filter(Boolean),
);

export const COUNTRY_CODE = process.env.COUNTRY_CODE ?? "";


export const ALLOWED_JIDS_WITH_NAMES = (() => {
  const jids = (process.env.ALLOWED_JIDS ?? "")
    .split(",")
    .map((jid) => jid.trim())
    .filter(Boolean);

  const names = (process.env.ALLOWED_JIDS_NAMES ?? "")
    .split(",")
    .map((name) => name.trim());

  return jids.map((jid, index) => ({
    jid,
    name: names[index] || `default user ${index + 1}`,
  }));
})();

export const AGENT_CONFIG = {
  maxIterations: Number(process.env.AGENT_MAX_ITERATIONS ?? 5),
  retryAttempts: Number(process.env.AGENT_RETRY_ATTEMPTS ?? 3),
  retryBaseDelay: Number(process.env.AGENT_RETRY_BASE_DELAY ?? 500),
};

export const SOURCE_CACHE_TTL_MS = Number(process.env.SOURCE_CACHE_TTL_MS ?? 15 * 60 * 1000);
export const ALLOWLIST_CACHE_TTL_MS = Number(process.env.ALLOWLIST_CACHE_TTL_MS ?? 5 * 60 * 1000);
export const COMMAND_PREFIX = process.env.COMMAND_PREFIX ?? "/";
export const SESSION_MEMORY_TTL_MS = Number(process.env.SESSION_MEMORY_TTL_MS ?? 20 * 60 * 1000);
export const SESSION_MEMORY_MAX_MESSAGES = Number(process.env.SESSION_MEMORY_MAX_MESSAGES ?? 6);
export const DEFAULT_RESPONSE_STYLE = process.env.DEFAULT_RESPONSE_STYLE ?? "concise";

/**
 * Maximum number of characters to include from each retrieved chunk
 * when injecting tool results into the LLM message history.
 * Prevents context window overflow from large policy documents.
 * ~1500 chars ≈ ~375 tokens, so 5 chunks ≈ ~1875 tokens max for tool results.
 */
export const MAX_CHUNK_CONTENT_CHARS = Number(process.env.MAX_CHUNK_CONTENT_CHARS ?? 1500);


