# Iny — WhatsApp RAG Chatbot for SST

## Overview

Iny is a WhatsApp-based RAG (Retrieval-Augmented Generation) chatbot that answers student queries about SST (Scaler School of Technology) policies, procedures, and campus operations. It uses an **agentic architecture** where an LLM orchestrates tool calls to retrieve information from a vector database.

**Key characteristics:**
- **Interface**: WhatsApp (via Baileys — reverse-engineered WhatsApp Web protocol)
- **Architecture**: Agentic RAG with tool calling
- **LLM**: Any OpenAI-compatible API (provider-agnostic via `AI_BASE_URL`)
- **Embeddings**: OpenAI `text-embedding-3-small` (1536 dimensions, direct OpenAI API)
- **Database**: PostgreSQL 16 + pgvector (chosen over dedicated vector DBs for cost — Postgres is already there)
- **Retrieval**: Hybrid — cosine similarity (HNSW) + full-text search (GIN/tsvector), fused via Reciprocal Rank Fusion (RRF)

## Architecture

### High-Level Flow

```
┌────────────────────────────────────────────────────────────────┐
│                   ENTRY POINT (src/index.ts)                   │
│  1. Initialize Database (Drizzle ORM + PostgreSQL + pgvector)  │
│  2. Load Allowlist from DB → in-memory cache                   │
│  3. Start Baileys WhatsApp Socket                              │
└────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
     ┌──────────────────┐ ┌──────────────┐ ┌─────────────────┐
     │ Message Handlers │ │Group Handlers│ │Connection Handler│
     │ (messages.ts)    │ │ (groups.ts)  │ │ (connection.ts)  │
     └────────┬─────────┘ └──────────────┘ └─────────────────┘
              │
              ▼
     ┌──────────────────────────────────────────────────────────┐
     │              NATURAL HANDLER (natural.ts)                 │
     │  Resolves context (DM/mention/reply), rate limits,        │
     │  dispatches commands, handles source queries               │
     └────────┬─────────────────────────────────────────────────┘
              │
              ▼
     ┌──────────────────────────────────────────────────────────┐
     │               CORE ENGINE (src/core/engine.ts)            │
     │  askIny() — channel-agnostic entry point                  │
     │  Manages: session memory, agent execution, source cache   │
     └────────┬─────────────────────────────────────────────────┘
              │
              ▼
     ┌──────────────────────────────────────────────────────────┐
     │              AGENT LOOP (src/core/agent.ts)               │
     │  executeAgent() — LLM + tool calling loop                 │
     │  ┌───────────────┐    ┌────────────────────────┐          │
     │  │ OpenAI SDK    │───▶│ Tool: search_policy_db │          │
     │  │ (any compat.) │    │ (hybrid vector+FTS)    │          │
     │  └───────────────┘    └────────────────────────┘          │
     └──────────────────────────────────────────────────────────┘
              │
              ▼
     ┌──────────────────────────────────────────────────────────┐
     │              PostgreSQL + pgvector                         │
     │  baileys_auth, messages, allowed_jids, documents, chunks  │
     └──────────────────────────────────────────────────────────┘
```

### Component Map

| Component | File(s) | Responsibility |
|-----------|---------|----------------|
| Entry Point | `src/index.ts` | Bootstrap: init DB, allowlist, start WhatsApp socket |
| Socket | `src/socket.ts` | Create Baileys WebSocket with DB-backed auth state |
| Stores | `src/store.ts` | In-memory caches: retry counters, group metadata, sent message IDs |
| Connection Handler | `src/handlers/connection.ts` | QR code display, reconnection logic |
| Group Handler | `src/handlers/groups.ts` | Populate group metadata cache |
| Message Handler | `src/handlers/messages.ts` | Persist messages, resolve JIDs, check allowlist, route to natural handler |
| Natural Handler | `src/handlers/natural.ts` | Context detection (DM/mention/reply), rate limiting, command dispatch, source queries, agent routing |
| Core Engine | `src/core/engine.ts` | `askIny()` — channel-agnostic API coordinating memory + agent + sources |
| Agent | `src/core/agent.ts` | `executeAgent()` — agentic LLM + tool loop with retries |
| Session Memory | `src/core/memory.ts` | Per-session sliding window conversation history (NodeCache + TTL) |
| Source Cache | `src/core/sources.ts` | Per-session retrieved chunk cache + citation builder |
| Core Types | `src/core/types.ts` | `ChatRequest`, `ChatResponse`, `ConversationTurn`, `RetrievedChunk`, etc. |
| Tool Schemas | `src/rag/tools.ts` | OpenAI function tool definitions for the LLM |
| Tool Executors | `src/rag/toolExecutors.ts` | `search_policy_database` implementation with chunk content truncation |
| Retrieval | `src/rag/retrieve.ts` | Hybrid search: pgvector cosine + tsvector FTS, fused via RRF |
| System Prompt | `src/rag/systemPrompt.ts` | 4-block state machine prompt + selectable response styles |
| Source Formatting | `src/rag/formatSources.ts` | Detect "show sources" requests, format citations for WhatsApp |
| Ingestion | `src/rag/ingest.ts` | PDF parsing → chunking → embedding → DB insertion |
| Chunker | `src/rag/chunker.ts` | Heading-aware token-bounded text chunking with page tracking |
| PDF Parser | `src/rag/parser.ts` | `pdftotext` CLI wrapper for text extraction |
| Embeddings | `src/embeddings/client.ts` | OpenAI embedding client with batch support |
| Auth State | `src/repositories/authState.ts` | PostgreSQL-backed Baileys auth + auto-migration from file-based sessions |
| Allowlist | `src/repositories/allowlist.ts` | In-memory Set + PostgreSQL sync, bidirectional LID/PN mapping |
| Message Repo | `src/repositories/messages.ts` | Protobuf message persistence for Baileys retry mechanism |
| JID Service | `src/services/jid.ts` | JID normalization, bidirectional PN↔LID cache, message JID resolution |
| Admin Service | `src/services/admin.ts` | Admin permission checks against `ADMIN_JIDS` with LID/PN awareness |
| Rate Limiter | `src/services/rateLimit.ts` | Sliding window in-memory rate limiters |
| Send Message | `src/services/sendMessage.ts` | Allowlist-guarded message sending + sent ID tracking |
| Markdown Utils | `src/utils/markdown.ts` | GitHub Markdown → WhatsApp formatting converter |
| Message Text | `src/utils/messageText.ts` | Extract text from Baileys message protobuf |
| Command Parser | `src/commands/parser.ts` | Quote-aware command tokenizer |
| Command Registry | `src/commands/registry.ts` | Case-insensitive command map with alias support |
| Admin Commands | `src/commands/admin.ts` | `/allow`, `/disallow`, `/allowlist` |
| Help Command | `src/commands/help.ts` | `/help` (admin-aware output) |
| Command Index | `src/commands/index.ts` | `createCommands()` — registers all commands |
| Web Server | `src/web/server.ts` | HTTP API (`/api/chat`, `/api/reset`) + static UI (internal testing) |
| Config | `src/config.ts` | All env vars and operational defaults |
| Logger | `src/logger.ts` | Pino structured logging with runtime level control |

### Scripts

| Script | Purpose |
|--------|---------|
| `scripts/ingest-docs.ts` | Ingest PDFs from `docs/` into PostgreSQL |
| `scripts/chat.ts` | Interactive CLI chat for testing the RAG engine |
| `scripts/test-agent-query.ts` | Automated test query against `askIny()` |
| `scripts/test-embed.ts` | Test embedding generation + cosine similarity |
| `scripts/test-hybrid-retrieval.ts` | Test hybrid retrieval against PostgreSQL |
| `scripts/test-jid-resolution.ts` | Test JID normalization, LID/PN mapping, allowlist, admin checks |

## Data Model

### Database Schema (PostgreSQL 16 + pgvector)

#### `baileys_auth` — WhatsApp Session State

Stores all Baileys authentication credentials and Signal protocol keys **in PostgreSQL** (not the filesystem). Combined with `makeCacheableSignalKeyStore` for in-memory caching of hot cryptographic keys. If a legacy `auth_info_baileys/` directory exists on disk, it is automatically migrated on first startup.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | e.g., `"creds"`, `"pre-key-1"`, `"session-..."` |
| `data` | `text` | JSON with `BufferJSON` serialization |
| `updated_at` | `timestamptz` | |

#### `messages` — Baileys Retry Storage

| Column | Type | Notes |
|--------|------|-------|
| `remote_jid` | `text` | |
| `message_id` | `text` | |
| `message` | `bytea` | Serialized protobuf |
| PK | composite | `(remote_jid, message_id)` |

#### `allowed_jids` — Access Control

| Column | Type | Notes |
|--------|------|-------|
| `jid` | `text` PK | `@s.whatsapp.net` format |
| `name` | `text` | |
| `added_by` | `text` | |
| `created_at` | `timestamptz` | |

#### `documents` — Source PDFs

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `title` | `text` | |
| `source_path` | `text` | |
| `content_hash` | `text` UNIQUE | SHA256 for deduplication |
| `source_type` | `text` | `"document"` (future: `"whatsapp"`) |
| `created_at` | `timestamptz` | |

#### `chunks` — Vector Chunks (1536 dimensions)

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `document_id` | `uuid` FK → documents | CASCADE delete |
| `content` | `text` | |
| `chunk_index` | `integer` | |
| `token_count` | `integer` | |
| `embedding` | `vector(1536)` | `text-embedding-3-small` |
| `source_type` | `text` | |
| `page_start` | `integer` | |
| `page_end` | `integer` | |
| `created_at` | `timestamptz` | |

**Indexes:**
- `chunks_document_id_idx` — B-tree on `document_id`
- `chunks_source_type_idx` — B-tree on `source_type`
- `chunks_page_idx` — B-tree on `(page_start, page_end)`
- `chunks_embedding_hnsw_idx` — HNSW on `embedding` using `vector_cosine_ops`
- `chunks_fts_idx` — GIN on `to_tsvector('english', content)`

### WhatsApp JID Formats

WhatsApp uses two JID formats. The system tracks both via bidirectional in-memory caching in `src/services/jid.ts`. This complexity affects allowlist checks, admin verification, and message routing.

| Format | Example | Use Case |
|--------|---------|----------|
| `@s.whatsapp.net` | `919876543210@s.whatsapp.net` | Phone-based, deterministic. Used for admin commands, allowlist entries. |
| `@lid` | `123456789@lid` | WhatsApp internal Linked Identity. Non-deterministic, used in message routing. |

Both `remoteJid` and `remoteJidAlt` are resolved per message. Admin and allowlist checks test all known JID forms for a user.

## Agent Architecture

### Agentic RAG Loop (`src/core/agent.ts`)

```
1. Build messages: [SYSTEM_PROMPT + STYLE_LAYER, ...history, user_message]
2. While iteration < maxIterations (default 5):
   a. Call LLM with tools (tool_choice: "auto")
   b. If no tool_calls → return final answer
   c. Execute each tool with retry (3 attempts, linear backoff)
   d. Truncate tool result chunk content to MAX_CHUNK_CONTENT_CHARS (default 1500)
   e. Add tool results to message history
   f. Record iteration trace for diagnostics
   g. Loop
3. If max iterations reached → log full iterationTrace at WARN level + return fallback
```

### Iteration Diagnostics

When max iterations are reached, the agent logs a structured `iterationTrace` at `WARN` level containing per-iteration `finishReason`, tool call names/args, and result success/chunkCount. Diagnosis patterns:

| `iterationTrace` pattern | Root cause |
|---|---|
| Repeated identical `args` across iterations | Retrieval loop — LLM ignores "no results" and retries same query |
| `chunkCount: 0` on all iterations | Query embeddings never matched — wrong keywords or threshold too high |
| `finishReason: "length"` | `max_tokens` too small — model's answer was cut off mid-tool-call |

### Tool: `search_policy_database`

Defined in `src/rag/tools.ts`, implemented in `src/rag/toolExecutors.ts`.

**Parameters:** `query` (string, required), `threshold` (number, optional, default 0.35)

**Execution flow:**
1. Embed query using OpenAI `text-embedding-3-small`
2. Run hybrid retrieval (`src/rag/retrieve.ts`):
   - **Semantic**: pgvector cosine similarity via HNSW index
   - **Keyword**: PostgreSQL `websearch_to_tsquery` + GIN index
   - **Fusion**: Reciprocal Rank Fusion (RRF) to merge and re-rank results
3. Filter by similarity threshold
4. Return top K results (default 5)
5. Truncate each chunk's content to `MAX_CHUNK_CONTENT_CHARS` before injecting into LLM context
6. Cache full (untruncated) chunks for "show sources" feature

### Context Budget Management

With small-context models (e.g., 8K tokens), the token budget is tight:

| Component | ~Tokens |
|---|---|
| System prompt + style layer | ~1,800 |
| Session history (default max 6 messages = 3 turns) | ~450 |
| User message | ~30 |
| Tool call + result (5 chunks × 375 tokens max each) | ~2,000 |
| `max_tokens` response budget | 1,024 |
| **Typical total** | **~5,300** |

Key controls:
- `MAX_CHUNK_CONTENT_CHARS` (default 1500) — truncates each chunk before LLM sees it
- `SESSION_MEMORY_MAX_MESSAGES` (default 6) — sliding window on conversation history
- `TOP_K` (default 5) — number of chunks returned per search

### Session Memory (`src/core/memory.ts`)

Per-session sliding window using NodeCache with TTL:
- Stores clean `user`/`assistant` turns only (no tool messages)
- Max messages: `SESSION_MEMORY_MAX_MESSAGES` (default 6 = 3 turns)
- TTL: `SESSION_MEMORY_TTL_MS` (default 20 minutes)
- Session key: `canonicalJid` for DMs, `canonicalJid:participantJid` for groups

## Access Control

### Design Philosophy

The allowlist is a **development safety rail**, not a production access control mechanism. It prevents accidental automated messages to unintended recipients during testing.

### Two-Tier System

1. **Admin JIDs** (from `ADMIN_JIDS` env var) — permanent access, can manage allowlist
2. **Allowlist** (in `allowed_jids` table) — managed via `/allow`, `/disallow`, `/allowlist` commands

Both tiers use bidirectional LID/PN resolution for JID matching.

## Commands

| Command | Admin Only | Description |
|---------|------------|-------------|
| `/allow <jid-or-phone> [name]` | Yes | Add user/group to allowlist |
| `/disallow <jid-or-phone>` | Yes | Remove from allowlist |
| `/allowlist` | Yes | List all allowlisted entries |
| `/help` | No | Show capabilities (admin sees command list, students see help guide) |

Parser: `src/commands/parser.ts` — quote-aware tokenizer with configurable prefix (default `/`).

## Web Interface (Internal Testing)

Standalone HTTP server at `src/web/server.ts` — used for internal testing, not production.

| Route | Method | Purpose |
|-------|--------|---------|
| `/` | GET | Serves `src/web/public/index.html` (single-page chat UI) |
| `/api/chat` | POST | `{ sessionId, message, style? }` → `{ message, citations, iterations, style }` |
| `/api/reset` | POST | `{ sessionId }` → `{ ok: true }` |

Port: `WEB_PORT` env var (default `8264` in Docker, `3000` locally).

## Message Processing Flow

```
WhatsApp message received (messages.upsert)
  │
  ├─► saveMessage() → persist protobuf to PostgreSQL
  ├─► Skip if bot's own reply
  ├─► resolveMessageJids() → resolve all PN/LID forms
  ├─► isAllowlisted()? → skip with warning if not
  ├─► getMessageText() → extract text from protobuf
  │
  └─► handleNaturalMessage()
        │
        ├─► Group message without mention/reply? → ignore
        ├─► Rate limited? → ignore
        │
        ├─► parseCommand() → is it a command?
        │     └─► Yes → check admin perms → execute command
        │
        ├─► isAskingForSources() + isReply?
        │     └─► Yes → getSessionSources() → formatSourcesForWhatsApp() → reply
        │
        └─► askIny({ sessionId, message, metadata })
              │
              ├─► getSessionHistory()
              ├─► executeAgent(message, history, style)
              │     └─► LLM loop with tool calls (see Agent Architecture)
              ├─► cacheSources()
              ├─► appendTurn()
              ├─► buildCitations()
              │
              └─► convertMarkdownToWhatsApp() → reply
```

## Ingestion Pipeline

```
npm run ingest  (or: docker exec iny-app node dist/scripts/ingest-docs.js)
  │
  ▼
glob("docs/*.pdf")
  │
  For each PDF:
    ├─► SHA256 hash → check documents.content_hash → skip if exists
    ├─► parsePdf() → pdftotext CLI → { title, pages[], fullText }
    ├─► chunkText(pages) → Chunk[] with headings, page ranges, token counts
    ├─► OpenAIEmbeddingClient.embedBatch(chunks)
    └─► DB Transaction:
          INSERT documents { id, title, sourcePath, contentHash, sourceType }
          INSERT chunks { id, documentId, content, chunkIndex, tokenCount,
                          embedding, sourceType, pageStart, pageEnd }
```

**Chunking strategy:** max 500 tokens, 50-token overlap, heading-aware (preserves breadcrumbs), page-tracked.

## Configuration

### Environment Variables

```bash
# Database
DATABASE_URL=postgres://iny:iny@localhost:5432/inydb  # use db:5432 in Docker

# LLM (any OpenAI-compatible API)
AI_API_KEY=              # required
AI_MODEL=gpt-4o-mini     # default
AI_BASE_URL=             # optional, for non-OpenAI providers

# Embeddings (OpenAI direct)
OPENAI_API_KEY=          # required (separate from AI_API_KEY)
EMBEDDING_MODEL=text-embedding-3-small

# RAG
SIMILARITY_THRESHOLD=0.35
TOP_K=5
MAX_CONTEXT_TOKENS=2000
MAX_CHUNK_CONTENT_CHARS=1500   # truncate chunks in tool results

# Agent
AGENT_MAX_ITERATIONS=5
AGENT_RETRY_ATTEMPTS=3
AGENT_RETRY_BASE_DELAY=500

# Session Memory
SESSION_MEMORY_TTL_MS=1200000      # 20 minutes
SESSION_MEMORY_MAX_MESSAGES=6      # 3 conversation turns

# Access Control
ADMIN_JIDS=919876543210@s.whatsapp.net   # comma-separated
ALLOWED_JIDS=                            # bootstrap allowlist
ALLOWED_JIDS_NAMES=
COUNTRY_CODE=91

# Logging
LOG_LEVEL=info       # fatal|error|warn|info|debug|trace
LOG_FILE=            # optional file path; stdout if unset

# Web UI
WEB_PORT=8264

# Misc
COMMAND_PREFIX=/
DEFAULT_RESPONSE_STYLE=concise   # concise|to-the-point|detailed
SOURCE_CACHE_TTL_MS=900000       # 15 minutes
ALLOWLIST_CACHE_TTL_MS=300000    # 5 minutes
```

## Known Issues (High-Impact)

These are issues an AI assistant should be aware of to avoid introducing regressions:

| Issue | Location | Impact | Notes |
|-------|----------|--------|-------|
| `AUTH_DIR` constant still exists in config | `config.ts` | Used only by the file→DB migration path in `authState.ts`. Not used at runtime. | Do not remove — migration still references it. |
| In-memory caches without size bounds | `allowlist.ts` (Set), `sourceCache` (NodeCache), `jid.ts` (Maps) | Unbounded memory growth in long-running process | Source cache and session memory have TTL; allowlist and JID caches do not. |
| `@hapi/boom` is a dependency but unused | `package.json` | Dead dependency | Can be safely removed. |

## Future Improvements (Planned, Not Implemented)

1. **WhatsApp Message Ingestion** — ingest messages from official groups, `sourceType: "whatsapp"`, new `search_whatsapp_messages` tool
2. **Instructor/POC Lookup** — new document type + `lookup_instructor` tool
3. **Open Access Mode** — `OPEN_ACCESS=true` env flag to bypass allowlist in production
4. **Event Calendar** — query upcoming events tool

## Development

### Prerequisites

- Node.js 22+
- PostgreSQL 16 with pgvector extension
- `pdftotext` CLI (`poppler-utils`)

### Setup

```bash
npm install

# Start database
docker compose up db -d

# Push schema
npm run db:push

# Ingest documents
npm run ingest

# Start WhatsApp bot (scan QR in terminal)
npm run dev

# Start web UI (separate terminal)
npm run web

# Interactive CLI chat
npm run chat
```

### npm Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start WhatsApp bot with hot reload + pino-pretty |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run compiled JS (production) |
| `npm run web` | Start web UI server with hot reload |
| `npm run chat` | Interactive CLI chat for testing |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run db:push` | Push schema to database |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run ingest` | Ingest PDFs from `docs/` |

---

*Last updated: 2026-09-03*
