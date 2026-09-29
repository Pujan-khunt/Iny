# Feature Specification: PostgreSQL Persistent Conversation Memory

- **Status**: Draft
- **Date**: 2026-09-29
- **Author**: Antigravity & Pujan

---

## 1. Overview & Objectives

Iny currently relies on [`InMemoryChatRepository`](../../src/adapters/outbound/chat-repository/InMemoryChatRepository.ts) to store multi-turn dialogue history. Because state is kept strictly in volatile process memory, every application restart, deployment, or crash wipes conversation context clean. For a real-world WhatsApp assistant, conversational durability across restarts is critical.

Furthermore, Iny currently lacks end-to-end turn observability. While individual message timestamps exist, the system does not record the exact duration of each conversation turn—from the moment Iny ingests the user's message, through DeepSeek reasoning and tool iterations, to the final WhatsApp message delivery.

This specification establishes production-grade, persistent conversation memory powered by **PostgreSQL 16+**, **Drizzle ORM**, and the **`postgres.js`** driver, employing the **Hybrid Envelope** storage pattern with first-class turn latency tracking.

### Goals
1. Implement a persistent outbound adapter `PostgresChatRepository` fulfilling [`ChatRepositoryPort`](../../src/core/ports/ChatRepositoryPort.ts).
2. Refactor [`DialogueTurn`](../../src/core/entities/DialogueTurn.ts) to replace the ambiguous `createdAt` timestamp with precise lifecycle timestamps:
   - `startedAt: Date`: The exact millisecond Iny received and began processing the incoming turn.
   - `completedAt: Date`: The exact millisecond the final assistant response was successfully delivered over WhatsApp.
3. Update [`ProcessIncomingMessage`](../../src/core/use-cases/ProcessIncomingMessage.ts) to record `startedAt` upon entry and `completedAt` upon Phase 2 delivery completion.
4. Store completed turns atomically using the **Hybrid Envelope** model: first-class relational columns (`id`, `user_id`, `user_query`, `assistant_response`, `tool_names`, `started_at`, `completed_at`, `duration_ms`) combined with a `messages` `JSONB` column preserving the full polymorphic execution trace.
5. Provide automatic duration calculation via a PostgreSQL generated column: `duration_ms INTEGER GENERATED ALWAYS AS (ROUND(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::integer) STORED`.
6. Enforce turn-atomic boundary invariants via dual-layer defense-in-depth:
   - Application-level domain assertions before database dispatch (`validation.ts`).
   - Database-level PostgreSQL `CHECK` constraints validating message sequence (`chk_dialogue_turns_messages`) and temporal ordering (`chk_dialogue_turns_timing` ensuring `completed_at >= started_at`).
7. Optimize retrieval performance using a composite B-Tree index on `(user_id, completed_at DESC)` to achieve sub-millisecond sliding window context loads.
8. Provide automatic schema migrations on startup via Drizzle Kit (`drizzle-orm/postgres-js/migrator`).
9. Guarantee graceful connection pool teardown on process termination (`SIGINT`/`SIGTERM`) to eliminate zombie connections on the host.
10. Maintain 100% deterministic, offline automated test suite execution using in-memory PostgreSQL emulation via `pg-mem`.
11. Fully retire and remove the deprecated `InMemoryChatRepository` and its tests to keep the codebase lean and free of dead code.

### Non-Goals (Future Specs)
- Vector embedding generation and semantic similarity search (`pgvector` queries). The schema prepares the foundation, but vector search will be implemented in a dedicated RAG / Long-Term Memory feature spec.
- User profile, settings, and authorization database tables.
- Distributed transaction coordinators or read-replicas.

---

## 2. Architectural Boundaries & Component Decomposition

To preserve Hexagonal Architecture purity and Single Responsibility boundaries, PostgreSQL persistence is isolated entirely to the outbound adapter layer. The domain core (`src/core/`) remains 100% pure TypeScript with zero external database dependencies.

```text
src/
├── core/
│   ├── entities/
│   │   ├── DialogueTurn.ts                          # Updated: startedAt and completedAt replace createdAt
│   │   └── Message.ts                               # Polymorphic message discriminated union
│   ├── use-cases/
│   │   └── ProcessIncomingMessage.ts                # Updated: tracks startedAt (entry) and completedAt (delivery)
│   └── ports/
│       └── ChatRepositoryPort.ts                    # Pure port interface (getRecentTurns, saveTurn, clearHistory)
├── adapters/
│   └── outbound/
│       └── chat-repository/
│           └── postgres/
│               ├── schema.ts                        # Drizzle ORM table definitions & types
│               ├── validation.ts                    # Pure domain invariant assertions for DialogueTurn
│               ├── metadata.ts                      # Pure extractor for user_query, assistant_response, tool_names
│               ├── migrator.ts                      # Startup migration runner helper
│               └── PostgresChatRepository.ts        # Driven adapter implementing ChatRepositoryPort
├── config.ts                                        # Validates DATABASE_URL and DB_MAX_CONNECTIONS
└── index.ts                                         # Composition root: bootstraps pool, runs migrations, wires adapter
drizzle/
└── migrations/                                      # Version-controlled SQL migration files
drizzle.config.ts                                    # Drizzle Kit configuration for migrations generation
```

### Component Responsibilities

1. **`DialogueTurn.ts` (Pure Domain Entity)**:
   - Encapsulates turn-atomic conversation boundaries.
   - Replaces `createdAt: Date` with:
     - `startedAt: Date`: Timestamp when processing started.
     - `completedAt: Date`: Timestamp when response delivery concluded.

2. **`ProcessIncomingMessage.ts` (Domain Orchestrator)**:
   - Captures `const startedAt = new Date();` immediately upon entering `execute(message)`.
   - Runs Phase 1 (Reasoning Phase) through `AgentLoop`.
   - Runs Phase 2 (Delivery Phase) via `MessageSenderPort.sendMessage(...)`.
   - Captures `const completedAt = new Date();` upon successful delivery.
   - Assembles `DialogueTurn { id, userId, messages, startedAt, completedAt }` and passes it to Phase 3 (Persistence Phase).

3. **`schema.ts` (Drizzle Definition)**:
   - Defines the `dialogue_turns` PostgreSQL table using `drizzle-orm/pg-core`.
   - Declares primary key (`uuid`), relational columns (`userId`, `userQuery`, `assistantResponse`, `toolNames`, `startedAt`, `completedAt`), stored generated column (`durationMs`), and the binary `messages` `jsonb` column.
   - Declares the composite index `idx_dialogue_turns_user_completed` on `(user_id, completed_at DESC)`.
   - Exports inferred select/insert TypeScript types (`DialogueTurnRow`, `NewDialogueTurnRow`).

4. **`validation.ts` (Pure Invariant Verification)**:
   - Evaluates a `DialogueTurn` before persistence to ensure domain compliance:
     - `messages` is an array with length >= 2.
     - `messages[0]` is a `UserMessage` (`role === 'user'`).
     - `messages[messages.length - 1]` is an `AssistantTextMessage` (`role === 'assistant' && type === 'text'`).
     - `completedAt >= startedAt` (duration cannot be negative).
   - Throws descriptive domain validation errors if invariants are violated.

5. **`metadata.ts` (Pure Transformation)**:
   - Extracts relational envelope fields from a domain `DialogueTurn`:
     - `userQuery`: Plain text from `turn.messages[0].content`.
     - `assistantResponse`: Plain text from final `AssistantTextMessage.content`.
     - `toolNames`: Deduplicated array of tool names invoked across any `AssistantToolCallMessage` in the turn.

6. **`migrator.ts` (Infrastructure)**:
   - Wraps `drizzle-orm/postgres-js/migrator` to execute pending SQL migrations from `drizzle/migrations/` at application boot.
   - Logs migration progress and ensures fatal exit if migration fails.

7. **`PostgresChatRepository.ts` (Outbound Driven Adapter)**:
   - Implements [`ChatRepositoryPort`](../../src/core/ports/ChatRepositoryPort.ts).
   - `getRecentTurns(userId, maxTurns)`: Executes index-assisted descending query on `completed_at`, maps rows into `DialogueTurn` domain entities, and reverses the array to guarantee chronological order (oldest to newest).
   - `saveTurn(turn)`: Validates invariants, extracts metadata, and inserts a row into `dialogue_turns`.
   - `clearHistory(userId)`: Deletes all turns for the specified user.

---

## 3. Storage Model & Data Integrity Invariants

### 3.1 The Hybrid Envelope Table Schema

```sql
CREATE TABLE IF NOT EXISTS dialogue_turns (
  id UUID PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  user_query TEXT NOT NULL,
  assistant_response TEXT NOT NULL,
  tool_names TEXT[] NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER GENERATED ALWAYS AS (
    ROUND(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::integer
  ) STORED,
  messages JSONB NOT NULL
);

-- Composite B-Tree index for microsecond sliding-window context retrieval
CREATE INDEX IF NOT EXISTS idx_dialogue_turns_user_completed
ON dialogue_turns (user_id, completed_at DESC);
```

### 3.2 Database-Level Invariant Constraints (`CHECK`)

To ensure database consistency even against manual queries or rogue processes, PostgreSQL enforces both structural and temporal invariants:

```sql
-- Structural invariant: messages array shape
ALTER TABLE dialogue_turns ADD CONSTRAINT chk_dialogue_turns_messages
CHECK (
  jsonb_typeof(messages) = 'array'
  AND jsonb_array_length(messages) >= 2
  AND (messages->0->>'role') = 'user'
  AND (messages->-1->>'role') = 'assistant'
  AND (messages->-1->>'type') = 'text'
);

-- Temporal invariant: completedAt must not precede startedAt
ALTER TABLE dialogue_turns ADD CONSTRAINT chk_dialogue_turns_timing
CHECK (completed_at >= started_at);
```

---

## 4. Canonical Data Flow & Execution Lifecycle

### 4.1 Application Boot & Migration Flow

```mermaid
sequenceDiagram
    participant Main as src/index.ts
    participant Cfg as src/config.ts
    participant Client as postgres.js (Pool)
    participant Migrator as Drizzle Migrator
    participant DB as PostgreSQL Server
    participant Rep as PostgresChatRepository
    participant UC as ProcessIncomingMessage

    Main->>Cfg: parseConfig(process.env)
    Cfg-->>Main: config (DATABASE_URL, DB_MAX_CONNECTIONS)
    Main->>Client: postgres(DATABASE_URL, { max: DB_MAX_CONNECTIONS })
    Main->>Migrator: runMigrations(db, "./drizzle/migrations")
    Migrator->>DB: Apply pending SQL migrations
    DB-->>Migrator: Migrations completed
    Main->>Rep: new PostgresChatRepository(db, logger)
    Main->>UC: new ProcessIncomingMessage(..., chatRepository: Rep, ...)
    Main->>Main: Start WhatsApp connection
```

### 4.2 Turn Latency Tracking & Persistence Pipeline

```mermaid
sequenceDiagram
    participant UC as ProcessIncomingMessage
    participant Loop as AgentLoop
    participant Sender as MessageSenderPort
    participant Rep as PostgresChatRepository
    participant Val as validation.ts
    participant Meta as metadata.ts
    participant DB as PostgreSQL (dialogue_turns)

    Note over UC: Ingestion: Capture startedAt = new Date()
    
    rect rgb(240, 248, 255)
        Note over UC,Loop: Phase 1: Reasoning Phase
        UC->>Rep: getRecentTurns(userId, maxTurns: 10)
        Rep->>DB: SELECT * FROM dialogue_turns WHERE user_id = $1 ORDER BY completed_at DESC LIMIT 10
        DB-->>Rep: rows (sorted newest first)
        Note over Rep: Map to DialogueTurn[] and reverse to chronological order
        Rep-->>UC: DialogueTurn[] (oldest first)
        UC->>Loop: run(...)
        Loop-->>UC: loopResult (finalText, sessionMessages)
    end

    rect rgb(240, 255, 240)
        Note over UC,Sender: Phase 2: Delivery Phase
        UC->>Sender: sendMessage(userId, loopResult.finalText)
        Sender-->>UC: Sent successfully
        Note over UC: Delivery: Capture completedAt = new Date()
    end

    rect rgb(255, 250, 240)
        Note over UC,DB: Phase 3: Persistence Phase
        UC->>UC: turn = { id, userId, messages, startedAt, completedAt }
        UC->>Rep: saveTurn(turn)
        Rep->>Val: assertValidDialogueTurn(turn)
        Val-->>Rep: Validated (shape & completedAt >= startedAt)
        Rep->>Meta: extractTurnMetadata(turn)
        Meta-->>Rep: { userQuery, assistantResponse, toolNames }
        Rep->>DB: INSERT INTO dialogue_turns (started_at, completed_at, ...)
        DB-->>Rep: Success (duration_ms computed automatically)
        Rep-->>UC: Return
    end
```

---

## 5. Error Handling & Lifecycle Policy

| Failure Scenario | Component Handling | Policy / Behavior |
| :--- | :--- | :--- |
| **Invalid Connection URL** | `src/config.ts` | Zod validation rejects invalid URI format at startup; terminates immediately with clear error. |
| **Database Unreachable at Boot** | `src/index.ts` / `migrator.ts` | Startup migration runner fails fast, logs fatal error with connection details, and exits with code `1`. |
| **Invalid Turn Invariant** | `validation.ts` | Rejects turn before SQL execution; throws descriptive error; prevents corrupted database writes. |
| **Timing Order Inversion** | `validation.ts` / DB Check | Throws validation error if `completedAt < startedAt`; DB check constraint rejects write. |
| **SQL Constraint Violation** | `PostgresChatRepository` | Catches database constraint error, logs structured error with `turnId` and `userId`, and propagates to use case caller. |
| **Query Timeout / Transient Drop** | `postgres.js` pool | Driver automatically reconnects on dropped TCP sockets. Unrecoverable failures throw transport errors caught in use case Phase 3. |
| **Application Shutdown (SIGINT/SIGTERM)** | `src/index.ts` | Signal handlers invoke `sqlClient.end({ timeout: 5 })`, closing pooled connections gracefully before process termination. |

---

## 6. Configuration & Environment Variables

Update `src/config.ts` with Zod schema validation:

```typescript
DATABASE_URL: z
  .string()
  .min(1, 'DATABASE_URL is required')
  .refine(
    (url) => url.startsWith('postgres://') || url.startsWith('postgresql://'),
    'DATABASE_URL must be a valid PostgreSQL connection URI (postgres:// or postgresql://)'
  ),

DB_MAX_CONNECTIONS: z
  .coerce
  .number()
  .int()
  .positive()
  .default(10),
```

Example `.env`:
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/iny
DB_MAX_CONNECTIONS=10
```

---

## 7. Deprecations & Removals

- Remove `src/adapters/outbound/chat-repository/InMemoryChatRepository.ts`.
- Remove `tests/adapters/outbound/chat-repository/InMemoryChatRepository.test.ts`.
- Update [`src/index.ts`](../../src/index.ts) to replace `InMemoryChatRepository` with `PostgresChatRepository`.

---

## 8. Testing & Verification Plan

In strict accordance with the Zero-Trust testing contract, all automated tests must run **100% offline with zero live external network or database server dependencies**:

1. **`tests/config.test.ts`**:
   - Verify valid `DATABASE_URL` configurations parse correctly.
   - Verify rejection of missing, empty, or non-Postgres URIs.
   - Verify `DB_MAX_CONNECTIONS` default and custom overrides.

2. **`tests/core/use-cases/ProcessIncomingMessage.test.ts`**:
   - Verify `startedAt` and `completedAt` are accurately attached to `DialogueTurn` upon execution.
   - Verify `completedAt` timestamp is greater than or equal to `startedAt`.

3. **`tests/adapters/outbound/chat-repository/postgres/validation.test.ts`**:
   - Verify acceptance of compliant turns (`[UserMessage, AssistantTextMessage]`, and turns with tool calls).
   - Verify rejection of turns with fewer than 2 messages.
   - Verify rejection when first message is not `UserMessage`.
   - Verify rejection when final message is not `AssistantTextMessage`.
   - Verify rejection when `completedAt < startedAt`.

4. **`tests/adapters/outbound/chat-repository/postgres/metadata.test.ts`**:
   - Verify extraction of user query text and assistant response text.
   - Verify extraction and deduplication of tool names from tool call messages.
   - Verify empty tool names array for standard conversational turns without tool calls.

5. **`tests/adapters/outbound/chat-repository/postgres/PostgresChatRepository.test.ts` (Offline via `pg-mem`)**:
   - Initialize in-memory PostgreSQL database using `pg-mem` and apply Drizzle schema.
   - Verify `saveTurn` persists turn with accurate relational columns (`started_at`, `completed_at`, `duration_ms`), and JSONB payload.
   - Verify `getRecentTurns` returns turns strictly in chronological order (oldest to newest).
   - Verify `getRecentTurns` enforces `maxTurns` limit and isolates distinct users.
   - Verify `clearHistory` removes all turns for the target user without affecting other users.
   - Verify database `CHECK` constraints reject illegal message shapes and timing inversions directly in SQL.

6. **Full Regression Suite**:
   - Run `npm test`: all unit and integration test files must pass.
   - Run `npm run build`: TypeScript compilation must succeed with 0 diagnostics.
