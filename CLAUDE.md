# Iny - WhatsApp RAG Chatbot for SST

## Overview

Iny is a WhatsApp-based RAG (Retrieval-Augmented Generation) chatbot designed to answer student queries about SST (Scaler School of Technology) policies, procedures, and campus operations. It uses an **agentic architecture** where an LLM orchestrates tool calls to retrieve information from a vector database.

**Key characteristics:**
- **Interface**: WhatsApp (via Baileys - reverse-engineered WhatsApp Web protocol)
- **Architecture**: Agentic RAG with tool calling
- **LLM Provider**: OpenAI-compatible interface (provider-agnostic)
- **Embeddings**: OpenAI `text-embedding-3-small` (1536 dimensions)
- **Database**: PostgreSQL with pgvector extension

## Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ENTRY POINT (src/index.ts)                          │
│  1. Initialize Database (Drizzle ORM + PostgreSQL + pgvector)               │
│  2. Load Allowlist from DB → in-memory cache                                │
│  3. Start Baileys WhatsApp Socket                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
         ┌──────────────────┐ ┌──────────────┐ ┌─────────────────┐
         │ Message Handlers │ │Group Handlers│ │Connection Handler│
         │ (messages.ts)    │ │ (groups.ts)  │ │ (connection.ts)  │
         └────────┬─────────┘ └──────┬───────┘ └────────┬────────┘
                  │                  │                  │
                  ▼                  ▼                  ▼
         ┌──────────────────────────────────────────────────────┐
         │                    AGENT SERVICE                      │
         │                 (src/services/agent.ts)               │
         │ ┌──────────────┐  ┌──────────────────┐               │
         │ │ LLM Loop     │  │ Tool Executors   │               │
         │ │ (OpenAI SDK) │  │ (search_policy_  │               │
         │ │              │  │  database)       │               │
         │ └──────────────┘  └────────┬─────────┘               │
         │                            │                         │
         └────────────────────────────┼─────────────────────────┘
                                      ▼
         ┌──────────────────────────────────────────────────────┐
         │                  RAG PIPELINE                         │
         │  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  │
         │  │ retrieve.ts │  │ sourceCache │  │ sendMessage  │  │
         │  │ (vector     │  │ .ts         │  │ .ts          │  │
         │  │  search)    │  │ (per-user   │  │ (WhatsApp    │  │
         │  │             │  │  cache)     │  │  formatting) │  │
         │  └─────────────┘  └─────────────┘  └──────────────┘  │
         └──────────────────────────────────────────────────────┘
                                      │
                                      ▼
         ┌──────────────────────────────────────────────────────┐
         │              PostgreSQL + pgvector                    │
         │  - documents (source PDFs)                            │
         │  - chunks (1536-dim vectors)                          │
         │  - allowed_jids (access control)                      │
         │  - messages (Baileys retry storage)                   │
         └──────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | File | Responsibility |
|-----------|------|----------------|
| Entry Point | `src/index.ts` | Initialize DB, allowlist, start WhatsApp socket |
| Socket | `src/socket.ts` | Create Baileys WebSocket, register handlers |
| Message Handlers | `src/handlers/messages.ts` | Persist messages, filter by allowlist, route to natural handler |
| Natural Handler | `src/handlers/natural.ts` | Detect context (DM/group mention/reply), rate limit, route to agent |
| Agent Service | `src/services/agent.ts` | Orchestrate LLM + tool loop, handle retries, format response |
| Tool Definitions | `src/rag/tools.ts` | Define tool schemas for LLM |
| Tool Executors | `src/rag/toolExecutors.ts` | Implement tool logic (search_policy_database) |
| Retrieve | `src/rag/retrieve.ts` | Vector similarity search via pgvector |
| System Prompt | `src/rag/systemPrompt.ts` | 4-block state machine prompt for agentic RAG |
| Ingestion | `src/rag/ingest.ts` | PDF parsing, chunking, embedding, DB insertion |
| Chunker | `src/rag/chunker.ts` | Heading-aware text chunking with token counting |
| Parser | `src/rag/parser.ts` | PDF text extraction via pdftotext CLI |
| Commands | `src/commands/` | Admin command implementations |
| Allowlist Repo | `src/repositories/allowlist.ts` | In-memory cache + DB sync for allowed JIDs |
| Source Cache | `src/services/sourceCache.ts` | Per-user cache of retrieved chunks for "show sources" |

## Data Model

### Database Schema

```sql
-- Messages for Baileys retry mechanism
CREATE TABLE messages (
  remote_jid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  message BYTEA NOT NULL,  -- Serialized protobuf
  PRIMARY KEY (remote_jid, message_id)
);

-- Allowlisted users/groups (development safety rail)
CREATE TABLE allowed_jids (
  jid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  added_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Source documents (PDFs)
CREATE TABLE documents (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  source_path TEXT NOT NULL,
  content_hash TEXT UNIQUE NOT NULL,  -- SHA256 for deduplication
  source_type TEXT DEFAULT 'document', -- 'document' | 'whatsapp'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vector chunks (1536 dimensions for text-embedding-3-small)
CREATE TABLE chunks (
  id UUID PRIMARY KEY,
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INT NOT NULL,
  token_count INT NOT NULL,
  embedding VECTOR(1536),
  source_type TEXT DEFAULT 'document',
  page_start INT DEFAULT 1,
  page_end INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Indexes

- `chunks_document_id_idx` - B-tree on document ID
- `chunks_source_type_idx` - B-tree on source type
- `chunks_page_idx` - B-tree on page range
- `chunks_embedding_hnsw_idx` - HNSW index for vector similarity search

### JID Formats

WhatsApp uses two JID formats:

| Format | Example | Use Case |
|--------|---------|----------|
| `@s.whatsapp.net` | `919876543210@s.whatsapp.net` | Phone-based, deterministic. Used for admin commands, allowlist. |
| `@lid` | `123456789@lid` | WhatsApp internal, non-deterministic. Used for message routing. |

**Design decision:** The system tracks both `remoteJid` and `remoteJidAlt`. Admin commands use `@s.whatsapp.net` format for deterministic user management.

## Agent Architecture

### Agentic RAG Pattern

The agent implements a **tool-calling loop**:

```
1. Build messages: [SYSTEM_PROMPT, user_message]
2. While iteration < MAX_ITERATIONS (5):
   a. Call LLM with tools (tool_choice: "auto")
   b. If no tool_calls → return final answer
   c. Execute each tool with retry (3 attempts, linear backoff)
   d. Add tool results to message history
   e. Loop
3. Return fallback if max iterations reached
```

### Tool: search_policy_database

**Purpose:** Search the vector database for policy information.

**Schema:**
```json
{
  "name": "search_policy_database",
  "description": "Search SST college policy database for information about academic policies, procedures, and campus operations.",
  "parameters": {
    "query": "string - The search query",
    "threshold": "number (optional) - Similarity threshold 0-1, default 0.35"
  }
}
```

**Execution flow:**
1. Embed query using OpenAI `text-embedding-3-small`
2. Perform cosine similarity search via pgvector
3. Filter by threshold (default 0.35)
4. Return top K results (default 5)
5. Cache chunks for "show sources" feature

### System Prompt Structure

The system prompt uses a **4-block state machine**:

1. **Block 1: Role and Domain Bounding**
   - Defines Iny as SST assistant
   - Sets strict boundaries (only SST-related queries)

2. **Block 2: Tool Utilization Protocols**
   - When to use tools (policy questions, procedures)
   - When NOT to use tools (greetings, general knowledge)

3. **Block 3: Strict Grounding Constraints**
   - MUST use only retrieved context
   - NO external knowledge, assumptions, or speculation
   - NO citations in responses (sources handled separately)

4. **Block 4: Fallback and Failure States**
   - How to handle empty results
   - How to handle irrelevant results
   - How to handle tool failures

### Future Tools

The architecture is designed to support additional tools:
- **WhatsApp message search** - Query ingested WhatsApp group messages
- **Instructor/POC lookup** - Search instructor database
- **Event calendar** - Query upcoming events

## Message Processing Flow

```
User sends WhatsApp message
        │
        ▼
Baileys socket receives 'messages.upsert' event
        │
        ▼
saveMessage() → Persist to PostgreSQL (for retries)
        │
        ▼
isBotReply? → Yes: skip
        │
        ▼
isAllowlisted(remoteJid, altJid)? → No: skip with warning
        │
        ▼
getMessageText() → Extract text from message proto
        │
        ▼
handleNaturalMessage()
        │
        ├─► Is command? → parseCommand() → commandRegistry.get() → execute()
        │
        ├─► Is "sources" request? → getSourcesForUser() → formatSourcesForWhatsApp() → reply
        │
        └─► Natural language → runAgent(userMessage, userJid)
                  │
                  ▼
         ┌────────────────────────────────────┐
         │ Agent Loop (max 5 iterations)      │
         │                                    │
         │ 1. LLM(messages, tools)            │
         │ 2. If tool_calls:                  │
         │    a. executeToolCallWithRetry()   │
         │    b. If search_policy_database:   │
         │       - retrieveTopK(query)        │
         │       - OpenAI embed query         │
         │       - pgvector cosine search     │
         │       - cacheSourcesForUser()      │
         │    c. Add tool result to messages  │
         │ 3. Else: return final answer       │
         │                                    │
         └────────────────────────────────────┘
                  │
                  ▼
         Convert Markdown → WhatsApp formatting (*bold*, ~strikethrough~)
                  │
                  ▼
         replyTo() → socket.sendMessage() → track sentMessageID
```

## Ingestion Pipeline

```
npm run ingest
        │
        ▼
glob("docs/*.pdf")
        │
        ▼
For each PDF:
  readFile() → Buffer
        │
        ▼
ingestFile(file, buffer, {maxTokens: 500, overlap: 50, sourceType: "document"})
        │
        ├─► SHA256 hash → check documents.content_hash → skip if exists
        │
        ├─► parsePdf() → pdftotext → {title, pages[], fullText}
        │
        ├─► chunkText(pages) → Chunk[] with headings, page ranges, token counts
        │
        ├─► OpenAIEmbeddingClient.embedBatch(chunk.content)
        │
        └─► DB Transaction:
              INSERT documents {id, title, sourcePath, contentHash, sourceType}
              INSERT chunks {id, documentId, content, chunkIndex, tokenCount, 
                             embedding, sourceType, pageStart, pageEnd}
```

### Chunking Strategy

- **Max tokens:** 500 (configurable)
- **Overlap:** 50 tokens
- **Heading-aware:** Preserves heading breadcrumbs in chunks
- **Page tracking:** Each chunk tracks its source page range

## Configuration

### Environment Variables

```bash
# Database
DATABASE_URL=postgres://iny:iny@localhost:5432/inydb

# LLM (OpenAI-compatible interface)
AI_API_KEY=your_api_key
AI_MODEL=gpt-4o-mini                    # Default: gpt-4o-mini
AI_BASE_URL=https://api.openai.com/v1   # Optional: for other providers

# Embeddings (OpenAI only)
OPENAI_API_KEY=your_openai_key
EMBEDDING_MODEL=text-embedding-3-small  # Default: text-embedding-3-small

# RAG Settings
SIMILARITY_THRESHOLD=0.35               # Default: 0.35
TOP_K=5                                 # Default: 5

# Access Control (comma-separated JIDs)
ADMIN_JIDS=919876543210@s.whatsapp.net
ALLOWED_JIDS=                           # Bootstrap allowlist
ALLOWED_JIDS_NAMES=                     # Names for bootstrap entries

# Admin Commands
COUNTRY_CODE=91                         # For phone number parsing
```

### Constants (config.ts)

- `AUTH_DIR` - Baileys auth state directory (`auth_info_baileys/`)
- `MAX_CONTEXT_TOKENS` - Max tokens for context (default: 2000)
- `MAX_CITATIONS` - Max citations to show (default: 3, currently unused)
- `FALLBACK_MESSAGE` - Response when no information found
- `WELCOME_MESSAGE` - Response to greeting triggers
- `WELCOME_TRIGGER_PATTERN` - Regex for greeting detection

## Access Control

### Design Philosophy

The allowlist is a **development safety rail**, not a production access control mechanism. It prevents accidental automated messages to unintended recipients during testing.

### Two-Tier System

1. **Admin JIDs** (from `ADMIN_JIDS` env var)
   - Permanent access
   - Can execute admin commands (`/allow`, `/disallow`, `/allowlist`)
   - Cannot be removed via commands

2. **Temporary Allowlist** (in `allowed_jids` table)
   - Managed via admin commands
   - Persisted in PostgreSQL, cached in memory
   - Can be cleared for production launch

### Future: Open Access Mode

Planned improvement: Add `OPEN_ACCESS=true` environment variable to bypass allowlist for production while keeping admin management capabilities.

## Commands

### Command Registry

Commands are registered in `src/commands/index.ts` with a Map-based registry supporting aliases.

### Available Commands

| Command | Admin Only | Description |
|---------|------------|-------------|
| `/allow <jid-or-phone> [name]` | Yes | Add user/group to allowlist |
| `/disallow <jid-or-phone>` | Yes | Remove from allowlist |
| `/allowlist` | Yes | List all allowlisted entries |
| `/help` | No | Show capabilities (admin sees command list) |

### Command Parser

**Canonical parser:** `src/commands/parser.ts` (quote-aware tokenizer)

The parser handles:
- Quoted arguments: `/allow "John Doe"`
- Escaped quotes
- Proper argument extraction

**Note:** The inline split in `natural.ts` should be replaced with the canonical parser.

## Known Issues & Technical Debt

### Critical Issues

| Issue | Location | Impact | Fix |
|-------|----------|--------|-----|
| Module-level mutable state | `toolExecutors.ts:20` | Race conditions with concurrent users | Pass via context or use request-scoped storage |
| Duplicate `getMessageText` | `messages.ts:10`, `natural.ts:19` | Maintenance burden | Extract to `src/utils/message.ts` |
| Duplicate chunker interfaces | `chunker.ts:9-16, 89-101` | Confusion | Remove duplicates |
| Duplicate helper functions | `chunker.ts:261-326` | Code bloat | Use top-level functions |

### High Priority Issues

| Issue | Location | Impact | Fix |
|-------|----------|--------|-----|
| Three `helpCommand` implementations | `admin.ts:187`, `help.ts`, `commands/index.ts` | Which runs? Confusion | Consolidate to single implementation |
| In-memory caches without TTL | `allowlist.ts:6`, `sourceCache.ts:29` | Unbounded memory growth | Add TTL + periodic cleanup |
| Deprecated `rag/format.ts` | `format.ts` | Dead code | Delete file |

### Medium Priority Issues

| Issue | Location | Impact | Fix |
|-------|----------|--------|-----|
| Hardcoded agent config | `agent.ts:39-43` | Inconsistent patterns | Move to `config.ts` |
| Two command parsers | `parser.ts`, `natural.ts:28-33` | Confusion | Use `parser.ts` everywhere |
| Unused `MAX_CITATIONS` | `config.ts:23` | Dead config | Remove or implement |
| Unused `pdf-parse` dependency | `package.json` | Unnecessary dependency | Remove from package.json |

## Future Improvements

### Planned Features

1. **WhatsApp Message Ingestion**
   - Ingest messages from official WhatsApp groups
   - Support `sourceType: 'whatsapp'` in chunks table
   - New tool: `search_whatsapp_messages`

2. **Instructor/POC Database**
   - New document type for instructor information
   - New tool: `lookup_instructor`

3. **Open Access Mode**
   - Environment flag `OPEN_ACCESS=true`
   - Bypass allowlist for production
   - Keep admin commands for management

4. **Message Storage Optimization**
   - Replace PostgreSQL persistence with in-memory LRU cache
   - Add TTL (e.g., 1 hour)
   - Reduce I/O overhead

### Architectural Improvements

1. **Dependency Injection**
   - Pass dependencies explicitly instead of importing modules
   - Improve testability

2. **Request-Scoped Context**
   - Replace module-level state with context objects
   - Support concurrent requests safely

3. **Structured Logging**
   - Add request IDs for tracing
   - Improve debugging in production

4. **Health Checks**
   - Add `/health` endpoint for monitoring
   - Database connection status
   - WhatsApp connection status

## Development

### Prerequisites

- Node.js 18+
- PostgreSQL 16 with pgvector extension
- `pdftotext` CLI (poppler-utils)

### Setup

```bash
# Install dependencies
npm install

# Set up database
docker run -d --name iny-db \
  -e POSTGRES_USER=iny \
  -e POSTGRES_PASSWORD=iny \
  -e POSTGRES_DB=inydb \
  -p 5432:5432 \
  pgvector/pgvector:pg16

# Generate migrations
npm run db:generate

# Run migrations
npm run db:push

# Ingest documents
npm run ingest

# Start development server
npm run dev
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run start` | Run compiled JavaScript |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run db:push` | Push schema to database |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run ingest` | Ingest PDFs from `docs/` directory |

## Testing Strategy

### Unit Tests (Planned)

- Command parsing
- Chunking logic
- Vector search
- Rate limiting

### Integration Tests (Planned)

- Agent loop
- Tool execution
- Message handling flow

### Manual Testing

1. Start bot with `npm run dev`
2. Scan QR code with WhatsApp
3. Add your JID to allowlist via `/allow`
4. Send test messages
5. Verify responses and check logs

## Monitoring & Observability

### Current State

- Pino structured logging
- Tool execution logging with timestamps
- Agent iteration logging

### Future Additions

- Request ID tracing
- Performance metrics
- Error tracking (Sentry)
- Usage analytics

---

*Last updated: 2026-08-26*
