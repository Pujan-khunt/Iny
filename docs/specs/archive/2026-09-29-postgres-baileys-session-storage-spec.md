# Feature Specification: PostgreSQL-Backed Baileys Session Storage with In-Memory Caching

- **Status**: Implemented
- **Date**: 2026-09-29
- **Author**: Antigravity & Pujan

---

## 1. Overview & Objectives

Iny currently relies on [`BaileysSessionManager`](../../src/adapters/outbound/whatsapp/BaileysSessionManager.ts), which uses Baileys' built-in `useMultiFileAuthState` to persist WhatsApp authentication credentials and cryptographic Signal Protocol keys as JSON files inside a local directory (`.baileys_auth/`).

While functional for local ad-hoc prototyping, file-based session management presents critical operational drawbacks:
1. **Host Disk Coupling (Stateful Containers)**: Storing credentials on the local filesystem prevents Iny from running as a stateless container. Deploying or upgrading Iny requires configuring host directory mounts, managing file permissions, and risking session loss if volume mounts are misconfigured.
2. **Production Instability (Official Baileys Warning)**: The official Baileys documentation explicitly advises against `useMultiFileAuthState` in production:
   > *"The `useMultiFileAuthState` function is not recommended for deployment in production. It uses the file state and there is no guarantee that it's good at session management, and will cause auth errors."*
   Under concurrent message loads, Node.js filesystem operations and Baileys' internal `async-mutex` can encounter lock contention or race conditions, corrupting `creds.json` or key files.
3. **I/O Overhead**: The Signal Protocol rekeys sessions on almost every sent and received message. Storing these keys as dozens of independent `.json` files results in continuous disk thrashing.

This specification replaces file-based session storage with a high-performance, resilient, **PostgreSQL-backed authentication store** powered by **Drizzle ORM**, fronted by Baileys' native in-memory cache **`makeCacheableSignalKeyStore`**, and utilizing **`BufferJSON`** serialization to ensure byte-perfect cryptographic key recovery.

### Goals
1. Implement a database-backed session manager [`PostgresBaileysSessionManager`](../../src/adapters/outbound/whatsapp/PostgresBaileysSessionManager.ts) satisfying the session contract needed by [`BaileysConnectionManager`](../../src/adapters/outbound/whatsapp/BaileysConnectionManager.ts).
2. Define a unified, partitioned PostgreSQL table schema `whatsapp_auth` using Drizzle ORM with composite primary key `(session_id, key)` to support single and multi-account architectures without schema modifications.
3. Guarantee binary buffer integrity across JSONB storage using Baileys' official `BufferJSON.replacer` and `BufferJSON.reviver`.
4. Wrap the database Signal key store with Baileys' official `makeCacheableSignalKeyStore` (in-memory TTL cache) so that 95%+ of hot cryptographic key lookups are served in microseconds without querying PostgreSQL.
5. Implement batch querying (`inArray`) for `keys.get` and transactional batch upserts/deletes for `keys.set` to replace Baileys' naive $N$-query loop with consolidated database roundtrips.
6. Make session purging (`DisconnectReason.loggedOut`) an atomic database deletion (`DELETE FROM whatsapp_auth WHERE session_id = $1`), eliminating filesystem deletion errors and orphan files.
7. Deprecate and remove local `.baileys_auth/` directory handling, making the Iny container fully stateless.
8. Maintain 100% deterministic, offline automated test suite execution using in-memory PostgreSQL emulation via `pg-mem`.

### Non-Goals
- Multi-tenant web dashboard or WhatsApp session management UI.
- Distributed active-active multi-instance socket clustering (the WhatsApp Web protocol allows only one active socket connection per registered account session).

---

## 2. Architectural Boundaries & Hexagonal Invariants

To preserve Hexagonal Architecture purity:
- **Domain Core (`src/core/`)**: Remains 100% pure TypeScript. Core entities, ports, and use cases have zero knowledge of WhatsApp authentication, session keys, or database tables.
- **Outbound Adapter (`src/adapters/outbound/whatsapp/`)**: Contains the Drizzle table definition, custom `AuthenticationState` implementation, caching layer, and `PostgresBaileysSessionManager`.
- **Composition Root (`src/index.ts`)**: Injects the shared Drizzle `db` instance and `logger` into `PostgresBaileysSessionManager`.

```text
src/
├── core/                                   # 100% Pure (Zero changes)
│   ├── entities/
│   ├── use-cases/
│   └── ports/
├── adapters/
│   └── outbound/
│       ├── chat-repository/
│       │   └── postgres/
│       │       └── schema.ts               # Existing dialogue_turns table
│       └── whatsapp/
│           ├── postgres/
│           │   └── schema.ts               # NEW: whatsapp_auth Drizzle table schema
│           ├── PostgresBaileysSessionManager.ts # NEW: PostgreSQL auth manager & Signal store
│           ├── BaileysSessionManager.ts    # DEPRECATED / REMOVED: File-based session manager
│           ├── BaileysConnectionManager.ts # Coordinates socket lifecycle
│           ├── BaileysMessageSenderAdapter.ts
│           └── BaileysPairingManager.ts
├── config.ts
└── index.ts                                # Composition Root: wires DB to PostgresBaileysSessionManager
```

---

## 3. Database Schema Design: Unified `whatsapp_auth` Table

Session data in Baileys consists of two parts:
1. `creds`: The root `AuthenticationCreds` object (contains registration status, device identity, pre-key count, and noise keys).
2. `keys`: Dynamic Signal Protocol keys partitioned by type and ID (`pre-key`, `session`, `sender-key`, `app-state-sync-key`, etc.).

Both components are stored in a unified key-value table partitioned by `session_id`:

```typescript
// src/adapters/outbound/whatsapp/postgres/schema.ts
import { pgTable, varchar, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';

export const whatsappAuth = pgTable(
  'whatsapp_auth',
  {
    sessionId: varchar('session_id', { length: 128 }).notNull().default('default'),
    key: varchar('key', { length: 255 }).notNull(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.key] }),
  ]
);

export type WhatsappAuthRow = typeof whatsappAuth.$inferSelect;
export type NewWhatsappAuthRow = typeof whatsappAuth.$inferInsert;
```

### Generated SQL Migration (`drizzle/migrations/0001_....sql`)
```sql
CREATE TABLE "whatsapp_auth" (
	"session_id" varchar(128) DEFAULT 'default' NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_auth_session_id_key_pk" PRIMARY KEY("session_id","key")
);
```

### Design Rationale:
1. **Primary Key `(session_id, key)`**:
   - For single-bot usage, `session_id` defaults to `'default'`.
   - For multi-account usage, `session_id` can be set to the account identifier (e.g. `'support'`, `'personal'`, or phone number). Keys never collide across accounts.
   - Lookups use the primary key B-Tree index with $O(\log N)$ speed.
2. **Atomic Session Purging**:
   - When a session is logged out, purging all keys is an instant single query:
     ```sql
     DELETE FROM whatsapp_auth WHERE session_id = $1;
     ```
3. **JSONB with Buffer Handling**:
   - `jsonb` stores the serialized credential and key payloads. Because Signal keys contain Node.js `Buffer` objects, values are stringified with `BufferJSON.replacer` before SQL insertion and parsed with `BufferJSON.reviver` upon database load.

---

## 4. Component Design: `PostgresBaileysSessionManager`

### 4.1. Interface Contract

`PostgresBaileysSessionManager` implements the session lifecycle consumed by `BaileysConnectionManager`:

```typescript
export interface BaileysSession {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}

export class PostgresBaileysSessionManager {
  constructor(
    private db: PgDatabase<any, any, any>,
    private logger: LoggerPort,
    private sessionId: string = 'default'
  ) {}

  /**
   * Initializes or restores the WhatsApp authentication session from PostgreSQL,
   * wrapping Signal keys with in-memory caching.
   */
  async initSession(): Promise<BaileysSession>;

  /**
   * Permanently deletes all authentication keys for this session from PostgreSQL upon logout.
   */
  async purgeSession(): Promise<void>;
}
```

### 4.2. Low-Level Mechanics

#### A. Binary Buffer Serialization
Standard `JSON.stringify` converts `Buffer` instances into `{ type: 'Buffer', data: [...] }` without prototype fidelity. Baileys provides `BufferJSON` specifically to encode buffers as `{"type":"Buffer","data":"base64..."}`:
- **Writing**:
  ```typescript
  const serialized = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
  ```
- **Reading**:
  ```typescript
  const revived = JSON.parse(JSON.stringify(row.value), BufferJSON.reviver);
  ```

#### B. Reading & Saving `creds`
1. On `initSession()`, execute:
   ```typescript
   const row = await this.readData('creds');
   const creds: AuthenticationCreds = row || initAuthCreds();
   ```
2. When Baileys emits `creds.update`:
   `saveCreds` writes `creds` to `whatsapp_auth` using an upsert (`onConflictDoUpdate`).

#### C. High-Performance Batch `SignalKeyStore`
Baileys' default file implementation executes $N$ single-file reads/writes. In `PostgresBaileysSessionManager`, we implement batch SQL queries:

1. **`get(type, ids)`**:
   - Formulate database keys: `dbKeys = ids.map(id => `${type}-${id}`)`.
   - If `ids` is empty, return `{}` immediately without querying.
   - Execute:
     ```typescript
     const rows = await this.db
       .select({ key: whatsappAuth.key, value: whatsappAuth.value })
       .from(whatsappAuth)
       .where(and(eq(whatsappAuth.sessionId, this.sessionId), inArray(whatsappAuth.key, dbKeys)));
     ```
   - Revive values with `BufferJSON.reviver`.
   - Special case: For `type === 'app-state-sync-key'`, transform with `proto.Message.AppStateSyncKeyData.fromObject(value)`.
   - Return `{ [id]: valueOrNull }` for all requested IDs.

2. **`set(data)`**:
   - Iterate categories and IDs.
   - Group into `toUpsert: Array<{ sessionId, key, value, updatedAt }>` and `toDelete: string[]`.
   - Execute inside a database transaction:
     ```typescript
     await this.db.transaction(async (tx) => {
       if (toUpsert.length > 0) {
         await tx
           .insert(whatsappAuth)
           .values(toUpsert)
           .onConflictDoUpdate({
             target: [whatsappAuth.sessionId, whatsappAuth.key],
             set: {
               value: sql`excluded.value`,
               updatedAt: new Date(),
             },
           });
       }
       if (toDelete.length > 0) {
         await tx
           .delete(whatsappAuth)
           .where(and(eq(whatsappAuth.sessionId, this.sessionId), inArray(whatsappAuth.key, toDelete)));
       }
     });
     ```

#### D. In-Memory Caching via `makeCacheableSignalKeyStore`
To avoid hammering PostgreSQL for repeated cryptographic lookups during active message exchange, the Signal key store is wrapped with Baileys' native `makeCacheableSignalKeyStore`:
```typescript
import { makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import pino from 'pino';

const cacheableKeys = makeCacheableSignalKeyStore(
  rawPostgresKeyStore,
  pino({ level: 'silent' })
);
```
- Signal key reads check NodeCache first (5-minute default TTL).
- Cache misses query PostgreSQL in batches.
- Key writes pass through to PostgreSQL and update the cache.

---

## 5. Composition Root & Deprecations

### 5.1. Drizzle Config Synchronization
Update `drizzle.config.ts` to scan all outbound schema files:
```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: [
    './src/adapters/outbound/chat-repository/postgres/schema.ts',
    './src/adapters/outbound/whatsapp/postgres/schema.ts',
  ],
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/iny',
  },
});
```

### 5.2. `src/index.ts` Wiring
1. Import `whatsappAuth` from `./adapters/outbound/whatsapp/postgres/schema`.
2. Provide combined schema to `drizzle(sqlClient, { schema: { ...chatSchema, ...whatsappSchema } })`.
3. Instantiate `sessionManager = new PostgresBaileysSessionManager(db, logger, 'default')`.
4. Remove all filesystem `.baileys_auth` references.

### 5.3. Deprecations Removed
- Delete `src/adapters/outbound/whatsapp/BaileysSessionManager.ts` (replaced by `PostgresBaileysSessionManager.ts`).
- Delete `tests/adapters/outbound/whatsapp/BaileysSessionManager.test.ts`.

---

## 6. Testing & Quality Assurance Plan

In accordance with our zero-trust engineering contract, all tests must run **100% offline and deterministically** without requiring a live PostgreSQL daemon or active network.

### 6.1. Unit Test Suite (`tests/adapters/outbound/whatsapp/PostgresBaileysSessionManager.test.ts`)
Using `pg-mem` with `drizzle-orm/node-postgres`:

1. **Initialization**:
   - `initSession` on empty database generates initial `AuthenticationCreds` (`initAuthCreds`) and returns valid `AuthenticationState`.
   - `saveCreds` writes credentials to `whatsapp_auth` table with `key = 'creds'`.
   - Subsequent `initSession` restores existing credentials exactly.
2. **Buffer Integrity**:
   - Save credentials with binary `Buffer` fields (e.g. noise key, identity key pair).
   - Reload session and assert restored keys are instances of `Buffer` with identical byte content (`Buffer.equals`).
3. **Signal Key Operations (`get`)**:
   - Querying non-existent key returns `null`.
   - Querying multiple keys returns a dictionary with existing keys populated and missing keys set to `null`.
   - Special handling for `app-state-sync-key` returns protobuf instance.
4. **Signal Key Operations (`set`)**:
   - Setting a key inserts a new row in `whatsapp_auth`.
   - Setting an existing key updates the row via `onConflictDoUpdate`.
   - Setting a key to `null` or `undefined` deletes the row from `whatsapp_auth`.
   - Multi-category batch `set` operations execute atomically.
5. **In-Memory Caching Verification**:
   - Verify that repeated `get` calls for the same key hit the in-memory cache without triggering database select queries.
6. **Session Isolation & Purge**:
   - Data stored under `sessionId = 'default'` is isolated from `sessionId = 'other'`.
   - Calling `purgeSession()` removes all keys for that session ID while leaving other session IDs intact.

---

## 7. Migration & Rollout Strategy

1. **Database Migration**: Run `npx drizzle-kit generate` to produce migration `0001_....sql` for `whatsapp_auth`. `runDatabaseMigrations` automatically applies it at startup.
2. **Clean Break**: Any legacy `.baileys_auth` local directories are deleted. On next startup, Iny initializes a fresh session in PostgreSQL and prints the WhatsApp pairing code to the logs.
3. **Container Readiness**: Once merged, the Iny container can be run without any host volume mounts for WhatsApp authentication.
