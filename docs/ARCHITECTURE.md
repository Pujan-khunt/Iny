# System Architecture

## 1. System Vision & The Hexagonal Boundary

Iny serves as a highly modular, zero-trust WhatsApp bot engine powered by LLMs. Our core philosophy relies heavily on Hexagonal Architecture (Ports and Adapters). The **Domain Core** (`src/core`) contains zero external runtime dependencies and remains pure. It dictates the business logic and how messages should be processed. Adapters handle all interaction with the outside world (like WhatsApp Web via Baileys, LLMs, and tool registries) by implementing interfaces (ports) defined by the core.

## 2. Mental Model & Core Concepts

- **Entities**: Pure data structures representing domain concepts:
  - `src/core/entities/Message.ts`: Discriminated union of `UserMessage`, `AssistantMessage` (`AssistantTextMessage` | `AssistantToolCallMessage`), and `ToolResultMessage`. Exposes `MessageFactory` for strongly-typed construction.
  - `src/core/entities/ToolCallRequest.ts`: Discriminated union of `ValidToolCallRequest` and `MalformedToolCallRequest` modeling parsed LLM function invocations.
  - `src/core/entities/DialogueTurn.ts`: Encapsulates a complete, turn-atomic interaction boundary (`UserMessage`, intermediate tool calls and results, final `AssistantTextMessage`, `startedAt`, and `completedAt`). Exposes `DialogueTurnFactory`.
- **Use Cases & Domain Services**: Application-specific business rules:
  - `src/core/use-cases/ProcessIncomingMessage.ts`: 4-phase orchestrator separating Conversation Context Retrieval, Reasoning, Delivery, and Persistence phases. Captures turn entry (`startedAt`) and transport completion (`completedAt`) timestamps, isolates dead transport failures, and prevents ghost turns in conversation memory.
  - `src/core/use-cases/AgentLoop.ts`: Pure domain service executing the ReAct (Reasoning + Acting) loop. Manages concurrent tool execution via `Promise.all`, circuit breaker forced synthesis, and malformed tool error injection.
- **Ports**: Interfaces that define how the core communicates with the outside world without knowing implementation details:
  - `src/core/ports/AccessControlPort.ts`: Core access control port (`AccessControlPort` with `authenticate`, `getUser`) and administrative user management port (`AccessControlAdminPort` with `seedUsers`, `countActiveUsers`).
  - `src/core/ports/MessageSenderPort.ts`: Outbound messaging transport.
  - `src/core/ports/LLMPort.ts`: Language model reasoning and tool call generation.
  - `src/core/ports/ChatRepositoryPort.ts`: Conversation history persistence.
  - `src/core/ports/LoggerPort.ts`: Structured, leveled logging.
  - `src/core/ports/ToolRegistryPort.ts`: Tool registration and execution contracts (`ToolDefinition` and `Tool`).
- **Tools**: Declarative tool extensions available to the LLM:
  - `src/tools/BaseTool.ts`: Abstract base class using the Template Method pattern, declarative Zod schemas, automatic JSON Schema generation, and self-correcting error string returns.
  - `src/tools/CalculatorTool.ts`: Safe arithmetic evaluation tool using recursive descent parsing (zero `eval`).
- **Inbound Adapters**: Entry points that trigger core use cases:
  - `src/adapters/inbound/whatsapp/WhatsAppInboundAdapter.ts`: Driving adapter listening for incoming WhatsApp messages via Baileys, coordinating eligibility filtering, access control authorization via `AccessControlPort`, JID/LID duality routing (resolving lookup addresses and companion LIDs), and dispatching valid user messages to `ProcessIncomingMessage`.
  - `src/adapters/inbound/whatsapp/BaileysMessageFilter.ts`: Evaluates incoming raw WhatsApp message eligibility (rejecting self-messages, non-text messages, groups `@g.us`, and broadcasts `@broadcast`).
  - `src/adapters/inbound/whatsapp/BaileysMessageParser.ts`: Pure translator mapping eligible raw Baileys messages into domain `UserMessage` entities with normalized epoch timestamps and canonical user ID overrides.
- **Outbound Adapters**: Concrete implementations of our core ports:
  - `src/adapters/outbound/access-control/postgres/PostgresAccessControlAdapter.ts`: Driven adapter implementing `AccessControlPort` and `AccessControlAdminPort` backed by PostgreSQL (`users` table) with O(1) indexed lookups, status gating, background asynchronous LID caching, and idempotent seeding.
  - `src/adapters/outbound/access-control/postgres/schema.ts`: Drizzle ORM schema defining `users` table with canonical `phone_number` PK, unique `pn_jid` and partial unique `lid_jid` indexes, and PostgreSQL check constraints.
  - `src/adapters/outbound/whatsapp/BaileysMessageSenderAdapter.ts`: Driven adapter implementing `MessageSenderPort` to transmit text payloads over the active WhatsApp socket.
  - `src/adapters/outbound/whatsapp/BaileysConnectionManager.ts`: Coordinates Baileys WebSocket lifecycle, connection updates, reconnection policies (515 restart, 408/428 transient disconnects), device logout (401), and incoming message distribution via concurrent, fault-isolated subscriber dispatch (`Promise.allSettled`). Accepts `BaileysSessionManagerPort`.
  - `src/adapters/outbound/whatsapp/PostgresBaileysSessionManager.ts`: Implements `BaileysSessionManagerPort` managing WhatsApp credentials and Signal Protocol keys in PostgreSQL (`whatsapp_auth` table) with in-memory caching (`makeCacheableSignalKeyStore`), `BufferJSON` buffer preservation, batch operations, and atomic purge upon logout.
  - `src/adapters/outbound/whatsapp/postgres/schema.ts`: Drizzle ORM table schema defining `whatsapp_auth` with composite primary key `(session_id, key)`.
  - `src/adapters/outbound/llm/DeepseekAdapter.ts`: Lean coordinator delegating to pure collaborators:
    - `DeepseekRequestMapper.ts`: Pure message and system prompt translation to OpenAI-compatible format with DeepSeek `reasoning_content` preservation.
    - `DeepseekToolMapper.ts`: Pure translation of domain tool definitions to OpenAI function tool schemas.
    - `DeepseekToolCallParser.ts`: Pure parser extracting `ValidToolCallRequest` and `MalformedToolCallRequest` domain entities.
    - `DeepseekResponseParser.ts`: Pure OpenAI response parser extracting completion text, chain-of-thought `reasoning`, and delegating tool call extraction.
    - `DeepseekErrorTranslator.ts`: Pure HTTP error status and SDK error translator.
  - `src/adapters/outbound/chat-repository/postgres/PostgresChatRepository.ts`: Persistent conversation history repository implementing `ChatRepositoryPort` using Drizzle ORM and `postgres.js` under the Hybrid Envelope pattern with sliding-window queries and database-level invariant enforcement.
  - `src/adapters/outbound/chat-repository/postgres/schema.ts`: Drizzle ORM table schema defining `dialogue_turns` with stored generated `duration_ms`, first-class `reasoning` text array, composite index on `(user_id, completed_at DESC)`, and PostgreSQL `CHECK` constraints.
  - `src/adapters/outbound/chat-repository/postgres/validation.ts`: Pure assertion validating dialogue turn structural and temporal invariants.
  - `src/adapters/outbound/chat-repository/postgres/metadata.ts`: Pure extractor mapping domain `DialogueTurn` entities into first-class relational columns (`userQuery`, `assistantResponse`, `toolNames`, `reasoning`).
  - `src/adapters/outbound/chat-repository/postgres/migrator.ts`: Startup database migration runner executing Drizzle migrations before service startup.
  - `src/adapters/outbound/logger/PinoLoggerAdapter.ts`: Structured logging wrapper around Pino with unambiguous signature routing.
  - `src/adapters/outbound/tool-registry/InMemoryToolRegistry.ts`: In-memory tool storage exposing clean tool definitions.
- **Shared Adapter Collaborators**: Reusable access control and identity validation components:
  - `src/adapters/common/whatsapp/WhatsAppJid.ts`: Pure utility integrating natively with `@whiskeysockets/baileys` functions (`jidNormalizedUser`, `isPnUser`, `isLidUser`, `areJidsSameUser`, etc.) for normalizing phone numbers and JIDs, classifying identity types (PN vs. LID, group, broadcast), and stripping multi-device suffixes.

## 3. Codebase Directory Map

```text
src/
├── core/                                   # The Pure Domain Core (Zero External Dependencies)
│   ├── entities/
│   │   ├── Message.ts                      # Message discriminated union
│   │   ├── ToolCallRequest.ts              # ValidToolCallRequest and MalformedToolCallRequest union
│   │   └── DialogueTurn.ts                 # Turn-atomic conversation unit
│   ├── use-cases/
│   │   ├── ProcessIncomingMessage.ts       # 4-phase orchestrator (Retrieval, Reasoning, Delivery, Persistence)
│   │   └── AgentLoop.ts                    # Pure ReAct reasoning loop & tool concurrency
│   ├── ports/                              # Interfaces for external dependencies
│   │   ├── AccessControlPort.ts            # Access control & admin user management ports
│   │   ├── ChatRepositoryPort.ts           # Conversation history persistence port
│   │   ├── LLMPort.ts                      # Language model reasoning & tool call port
│   │   ├── LoggerPort.ts                   # Structured logging port
│   │   ├── MessageSenderPort.ts            # Outbound messaging transport port
│   │   └── ToolRegistryPort.ts             # Tool registry and execution port
│   └── errors/
│       └── LLMErrors.ts                    # Custom domain error hierarchy
├── tools/                                  # Concrete Domain Tools
│   ├── BaseTool.ts                         # Declarative base tool with Zod schema reflection
│   └── CalculatorTool.ts                   # Safe recursive descent arithmetic evaluator
├── adapters/                               # Interaction with the outside world
│   ├── common/                             # Shared adapter utilities
│   │   └── whatsapp/
│   │       └── WhatsAppJid.ts              # Native Baileys JID/LID classification and normalization
│   ├── inbound/
│   │   └── whatsapp/
│   │       ├── BaileysMessageFilter.ts     # Reception eligibility filter (reject fromMe, groups, non-text)
│   │       ├── BaileysMessageParser.ts     # Pure domain UserMessage translator with canonical ID override
│   │       └── WhatsAppInboundAdapter.ts   # WhatsApp event driver with LID resolution & ProcessIncomingMessage
│   └── outbound/
│       ├── access-control/
│       │   └── postgres/                   # PostgreSQL access control adapter
│       │       ├── schema.ts               # Drizzle ORM schema for users table
│       │       └── PostgresAccessControlAdapter.ts # Driven adapter implementing AccessControlPort & AccessControlAdminPort
│       ├── chat-repository/
│       │   └── postgres/                   # PostgreSQL conversation memory adapter
│       │       ├── schema.ts               # Drizzle ORM schema & table constraints
│       │       ├── validation.ts           # Turn structural & temporal invariants
│       │       ├── metadata.ts             # Relational envelope metadata extractor
│       │       ├── PostgresChatRepository.ts # Outbound adapter implementing ChatRepositoryPort
│       │       └── migrator.ts             # Startup Drizzle migration runner
│       ├── llm/
│       │   ├── DeepseekAdapter.ts          # Lean coordinator for DeepSeek completions
│       │   ├── DeepseekRequestMapper.ts    # Pure domain to OpenAI message mapper
│       │   ├── DeepseekToolMapper.ts       # Pure domain to OpenAI tool mapper
│       │   ├── DeepseekToolCallParser.ts   # Pure OpenAI tool call to domain request parser
│       │   ├── DeepseekResponseParser.ts   # Pure OpenAI response parser
│       │   └── DeepseekErrorTranslator.ts  # Pure HTTP and SDK error translator
│       ├── logger/
│       │   └── PinoLoggerAdapter.ts        # Structured logging using Pino
│       ├── tool-registry/
│       │   └── InMemoryToolRegistry.ts     # In-memory tool registry implementation
│       └── whatsapp/
│           ├── postgres/
│           │   └── schema.ts               # Drizzle ORM schema for whatsapp_auth table
│           ├── BaileysConnectionManager.ts # WebSocket lifecycle & reconnection coordinator
│           ├── BaileysMessageSenderAdapter.ts # Outbound transport implementing MessageSenderPort
│           ├── BaileysPairingManager.ts    # First-time device pairing code coordinator
│           └── PostgresBaileysSessionManager.ts # PostgreSQL auth credentials & Signal key manager
├── config.ts                               # Fail-fast configuration with pure parseConfig
├── index.ts                                # The Composition Root
├── Dockerfile                              # Multi-stage hardened build (node:22-bookworm-slim, USER node)
├── docker-compose.yml                      # Orchestration for PostgreSQL 16 & Iny application
└── .dockerignore                           # Security boundary excluding secrets and test files
```

## 4. Canonical Control & Data Flow

```mermaid
sequenceDiagram
    participant WA as WhatsApp Network
    participant Conn as BaileysConnectionManager.ts
    participant Inbound as WhatsAppInboundAdapter.ts
    participant Filter as BaileysMessageFilter.ts
    participant AccessControl as AccessControlPort / PostgresAccessControlAdapter.ts
    participant Parser as BaileysMessageParser.ts
    participant UC as ProcessIncomingMessage.ts
    participant Loop as AgentLoop.ts
    participant Repo as ChatRepositoryPort.ts
    participant Reg as ToolRegistryPort.ts
    participant LLM as LLMPort.ts
    participant Sender as BaileysMessageSenderAdapter.ts
    participant Log as LoggerPort.ts

    WA->>Conn: messages.upsert
    Conn->>Inbound: dispatch('messages.upsert', { messages })
    
    loop For each message in batch
        Inbound->>Filter: isEligible(rawMessage)
        alt Ineligible (fromMe / non-text / group / broadcast)
            Filter-->>Inbound: false
            Note over Inbound: Discard (zero token cost)
        else Eligible
            Filter-->>Inbound: true
            Note over Inbound: resolveSenderRouting -> lookupAddress, companionLidJid
            Inbound->>AccessControl: authenticate(lookupAddress, companionLidJid)
            alt Unauthorized or Inactive Sender
                AccessControl-->>Inbound: null
                Note over Inbound: Discard & log debug/warn
            else Authorized & Active
                AccessControl-->>Inbound: UserRecord
                Note over Inbound: user.pnJid is verified canonical phone identity
                Inbound->>Parser: parse(rawMessage, user.pnJid)
                Parser-->>Inbound: userMessage (canonical userId)

                Inbound->>UC: execute(userMessage)
                UC->>Log: logger.child({ userId, messageId })
                UC->>Log: log.info("Processing incoming message")

                rect rgb(245, 245, 255)
                    Note over UC,Repo: Phase 1: Conversation Context Retrieval
                    UC->>Repo: chatRepository.getRecentTurns(userId, maxHistoryTurns)
                    Repo-->>UC: DialogueTurn[] (history)
                end

                rect rgb(240, 248, 255)
                    Note over UC,Loop: Phase 2: Reasoning Phase
                    UC->>Reg: toolRegistry.getToolDefinitions()
                    Reg-->>UC: ToolDefinition[]
                    UC->>Loop: loop.run(userMessage, history, tools, log)

                    loop ReAct Tool Loop (up to maxToolIterations)
                        Loop->>LLM: llm.generateResponse(systemPrompt, workingHistory, tools)
                        alt Response: Text
                            LLM-->>Loop: { type: 'text', content, reasoning }
                            Note over Loop: Break loop
                        else Response: Tool Calls
                            LLM-->>Loop: { type: 'tool_calls', toolCalls, content, reasoning }
                            Loop->>Reg: Promise.all(toolCalls.map(executeTool))
                            Reg-->>Loop: Tool results / reflected error strings
                            Note over Loop: Append tool messages to workingHistory & iterate
                        end
                    end

                    opt Circuit Breaker (if max iterations reached without text)
                        Loop->>LLM: llm.generateResponse(systemPrompt, workingHistory, tools, { forcedSynthesis: true })
                        LLM-->>Loop: { type: 'text', content, reasoning }
                    end
                    Loop-->>UC: loopResult (finalText, reasoning, sessionMessages)
                end

                rect rgb(240, 255, 240)
                    Note over UC,Sender: Phase 3: Delivery Phase
                    UC->>Sender: sender.sendMessage(userId, finalText)
                    Sender->>Conn: getSocket()
                    Conn-->>Sender: activeSocket
                    Sender->>WA: sock.sendMessage(userId, { text: finalText })
                    alt Delivery Fails
                        Sender-->>UC: Transport Error
                        UC->>Log: log.error("Failed to deliver message...")
                        Note over UC: Abort (do not retry over dead transport; do not save turn)
                    end
                end

                rect rgb(255, 250, 240)
                    Note over UC,Repo: Phase 4: Persistence Phase
                    UC->>Repo: chatRepository.saveTurn(turn)
                    UC->>Log: log.info("Message processed successfully")
                end
            end
        end
    end
```

## 5. Architectural Invariants

- **Pure Core**: `src/core/` must never import from outside of itself. It contains solely pure TypeScript interfaces, entities, use cases, and errors with zero runtime external dependencies.
- **Turn-Atomic Conversation Memory**: History persistence is partitioned into complete `DialogueTurn` boundaries. Sliding windows and retention limits prune complete turns, never bisecting an assistant tool call from its corresponding tool response.
- **Single Composition Root**: In production runtime code, `src/index.ts` is the only place where adapters and the core are stitched together. Dependency injection is wired up here (unit tests and internal adapter factory methods like `PinoLoggerAdapter.child()` may instantiate adapters directly).
- **Fail-Fast Startup**: `src/config.ts` uses Zod to validate all environment variables at startup. Pure `parseConfig()` is exported for direct testing without dynamic module reloading. Application fails fast if no active authorized users exist.
- **Persistent Access Control & Canonical Identity Duality**: WhatsApp access authorization is persisted in PostgreSQL (`users` table with canonical `phone_number` primary key, unique `pn_jid`/`lid_jid` indexes, and `status` lifecycle states: active, pending, revoked, suspended). Modern WhatsApp linked identities (`@lid`) are mapped back to canonical phone numbers (`@s.whatsapp.net`), ensuring that conversation memory (`dialogue_turns`) is never fragmented across identity changes or devices.
- **Inbound Access Control Boundary**: Inbound messages are authenticated against `AccessControlPort` at the adapter boundary before any use case execution or LLM token expenditure. Outbound transport focuses strictly on reliable delivery over the active Baileys socket.
- **Hybrid Envelope Persistence**: Conversation turns are persisted with first-class relational columns for operational queries (`user_query`, `assistant_response`, `tool_names`, `started_at`, `completed_at`, and generated `duration_ms`) while preserving the full fidelity ordered `Message[]` sequence in a `JSONB` payload validated by database-level PostgreSQL `CHECK` constraints.
- **Stateless Container & Database-Backed Auth**: WhatsApp authentication state and Signal Protocol cryptographic keys are persisted in PostgreSQL (`whatsapp_auth` table with composite primary key `(session_id, key)`), eliminating host filesystem bindings and directory mutex races. High-frequency Signal keys are cached in memory via `makeCacheableSignalKeyStore`, and binary buffer prototypes are preserved across `jsonb` serialization using `BufferJSON`.
- **Hardened Multi-Stage Containerization**: The runtime environment executes in an isolated Docker container based on `node:22-bookworm-slim` across both builder and runner stages, guaranteeing `glibc` runtime binary compatibility with Baileys' native modules on ARM64 (Oracle Cloud Ampere A1) and x86_64. Production images drop root privileges and run strictly as unprivileged `USER node`.
- **Loopback-Only Database Port Exposure**: PostgreSQL port 5432 is bound strictly to `127.0.0.1:5432:5432` on the host, preventing public internet exposure while enabling secure local tool access (Drizzle Studio, GUI clients) via SSH tunnels. All application communication occurs across an isolated Docker bridge network (`iny-network`).

## 6. "How Do I..." Recipe Guide

### Recipe 1: Add Inbound Adapter
1. Create a new directory in `src/adapters/inbound/` (e.g., `telegram/`).
2. Write an adapter class that takes use cases (e.g., `ProcessIncomingMessage`) as dependencies.
3. Listen to external events (like a webhook or socket message) and invoke the use case.
4. Wire it up in `src/index.ts`.

### Recipe 2: Add Outbound Port & Adapter
1. Define the port interface in `src/core/ports/` (e.g., `DatabasePort.ts`).
2. Create the adapter in `src/adapters/outbound/` (e.g., `postgres/PostgresAdapter.ts`) implementing the port.
3. Inject it into the necessary use cases via `src/index.ts`.

### Recipe 3: Create a Tool
1. Create a new tool file in `src/tools/` (e.g., `WeatherTool.ts`).
2. Define a declarative Zod schema for its input parameters.
3. Extend `BaseTool<typeof schema>` and implement `protected async run(args: z.infer<typeof schema>): Promise<string>`.
4. Register the tool with `InMemoryToolRegistry` in `src/index.ts`.

### Recipe 4: Deploy or Inspect with Docker Compose
1. Ensure `.env` is configured with required secrets (`DEEPSEEK_API_KEY`, `BOT_PHONE_NUMBER`, `ALLOWED_USERS`, `POSTGRES_PASSWORD`).
2. Start services in the background: `docker compose up -d`.
3. Follow application logs: `docker compose logs -f app`.
4. Inspect database locally via SSH tunnel without public port exposure:
   - On local workstation: `ssh -N -L 5432:127.0.0.1:5432 user@vps-ip`
   - Run Drizzle Studio locally: `npx drizzle-kit studio` (connecting to `localhost:5432`).

### Recipe 5: Pre-Merge Review & Archival Ritual
1. Perform an in-depth review of all PR changes (architecture, correctness, test coverage, and code hygiene).
2. Review and update `docs/ARCHITECTURE.md` to ensure architectural documentation accurately reflects all boundaries and flows.
3. Move the completed feature specification from `docs/specs/` to `docs/specs/archive/` within the same feature branch.
4. Verify all tests pass (`npm test`) and compilation succeeds (`npm run build`).
5. Commit and merge the pull request.
