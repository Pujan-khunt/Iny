# WhatsApp Message Router & Inbound Pipeline Specification

## 1. Problem Statement & Motivation

Currently, inbound WhatsApp message reception and dialogue turn management in Iny suffer from architectural asymmetry, naming drifts, code duplication, and leaky boundary abstractions across driving and driven adapters:

1. **Architectural Asymmetry & Ambiguous Naming**:
   - `WhatsAppInboundAdapter` is named after the transport protocol ("WhatsApp") rather than its semantic role. In reality, it drives interactive 1-on-1 student AI dialogue turns via `ProcessIncomingMessage`.
   - `FoodAnnouncementsInboundAdapter` is named after a domain business feature ("Food Announcements") rather than transport mechanics, staging broadcast group messages into PostgreSQL via `MessStagingRepositoryPort`.
   - Both adapters sit at the same architectural tier in `src/adapters/inbound/whatsapp/`, yet reflect fundamentally different abstraction paradigms.

2. **Domain Terminology Drift ("Chat" vs. "Conversation" vs. "DialogueTurn")**:
   - The core entity is [`DialogueTurn`](file:///home/pujan/iny/src/core/entities/DialogueTurn.ts) and the persistent database table is `dialogue_turns`.
   - However, the persistence port and adapter refer to `Chat` (`ChatRepositoryPort`, `PostgresChatRepository`, `src/adapters/outbound/chat-repository/`, `ChatRepositoryContextRetrievalAdapter`).
   - The use case was named `ProcessIncomingMessage`.
   - To achieve zero-trust conceptual clarity, all references to "chat" across domain ports, use cases, and repositories must be standardized on the canonical domain term **`DialogueTurn`**.

3. **Duplicated Envelope Validation & Protobuf Unwrapping**:
   - Both inbound adapters subscribe directly to `BaileysConnectionManager.subscribe("messages.upsert", ...)`.
   - Both independently unpack raw Baileys `WAMessage` protobuf structures, inspect `msg.key` envelope fields (`fromMe`, `id`, `remoteJid`, `participant`), call `normalizeMessageContent(msg.message)`, unwrap container messages (ephemeral, view-once), and check `conversation` vs. `extendedTextMessage.text`.
   - Identity resolution (PN `@s.whatsapp.net` vs. LID `@lid`, participant resolution for group chats, companion LID caching) is fragmented across `BaileysMessageFilter`, `BaileysMessageParser`, and `FoodAnnouncementPayloadParser`.

4. **Inconsistent Ingestion Semantics & Redundant Looping**:
   - `WhatsAppInboundAdapter` restricts processing to `upsert.type === "notify"`, while `FoodAnnouncementsInboundAdapter` accepts both `"notify"` and `"append"` (replayed backlog).
   - Each adapter maintains its own `for (const msg of messages)` loop and ad-hoc `try/catch` per-message fault boundary.

5. **Missing Core Use Case for Announcement Staging**:
   - The business logic for staging announcements (validating acceptable message types, orchestrating media download, formatting staging records, handling deduplication) currently lives directly inside the inbound adapter and parser. In accordance with Hexagonal Architecture, this orchestration belongs in a dedicated pure domain use case (`StageIncomingFoodAnnouncement`).

6. **Misclassified Use Cases and Services**:
   - `AgentLoop` is currently located in `src/core/use-cases/AgentLoop.ts`, but it is not an entry-point workflow triggered by an external adapter. It is a reusable ReAct reasoning domain service that belongs in `src/core/services/AgentLoop.ts`.

---

## 2. Requirements & Domain Logic

### 2.1 Normalized WhatsApp Message Contract

To isolate subscribers from raw `@whiskeysockets/baileys` protobuf structures and version drift, Baileys `messages.upsert` payloads must pass through an event-level normalization middleware (`WhatsAppMessageNormalizer`) that produces a clean, strongly-typed domain-agnostic envelope:

```ts
export type WhatsAppChatType = "direct" | "group" | "broadcast";

export type WhatsAppContentType = "text" | "image" | "document" | "unsupported";

export interface NormalizedWhatsAppMessage {
	/** Unique stanza message identifier (e.g. wamid or Baileys ID). */
	readonly messageId: string;
	/**
	 * Stanza target conversation container JID:
	 * - In direct chats: remote user JID (@s.whatsapp.net or @lid).
	 * - In group chats: group JID (@g.us).
	 * - In broadcasts: broadcast JID (@broadcast).
	 */
	readonly chatJid: string;
	/** Broad classification of the conversation container. */
	readonly chatType: WhatsAppChatType;
	/**
	 * Message author JID:
	 * - In direct chats: identical to chatJid.
	 * - In group chats: the individual participant who posted the message.
	 */
	readonly senderJid: string;
	/** Sender identity format classification. */
	readonly senderType: "pn" | "lid";
	/** Optional companion LID JID for direct chats (when remoteJidAlt is available). */
	readonly companionLidJid: string | null;
	/** True if the message was authored by the connected bot identity. */
	readonly fromMe: boolean;
	/** Message creation epoch timestamp in milliseconds. */
	readonly timestamp: number;
	/** Extracted content payload metadata. */
	readonly content: {
		readonly type: WhatsAppContentType;
		readonly text: string | null;
		readonly mimeType: string | null;
		readonly fileName: string | null;
	};
	/**
	 * Lazy media download closure.
	 * Defers binary buffer fetching until explicitly invoked by a handler that requires raw media.
	 * Resolves to Buffer if media exists and download succeeds, or null if unsupported/failed.
	 */
	readonly downloadMedia: () => Promise<Buffer | null>;
}
```

### 2.2 Functional First-Match Message Router (`WhatsAppMessageRouter`)

Rather than relying on unrestricted pub/sub fan-out (which causes duplicate processing conflicts when message populations overlap, such as Admin Commands vs. AI Direct Chat), routing operates as an **ordered first-match handler chain**:

1. **Registration Contract**:
   ```ts
   export type WhatsAppUpsertType = "notify" | "append";

   export interface WhatsAppMessageHandler {
   	readonly name: string;
   	/**
   	 * Accepted Baileys upsert event modes.
   	 * Default: ["notify"] (real-time messages only).
   	 * Handlers wanting historical replay (e.g. food announcements) explicitly declare ["notify", "append"].
   	 */
   	readonly acceptedUpsertTypes?: readonly WhatsAppUpsertType[];
   	matches(message: NormalizedWhatsAppMessage): boolean;
   	handle(message: NormalizedWhatsAppMessage): Promise<void>;
   }
   ```
2. **Dispatch Discipline**:
   - Handlers are evaluated in sequence based on registration order.
   - For every incoming message in a `messages.upsert` batch, the router first checks whether the current event type (`notify` vs. `append`) is included in `handler.acceptedUpsertTypes ?? ["notify"]`. If not accepted, the handler is skipped immediately without evaluating `matches()`.
   - The router then finds the **first** handler whose `matches(message)` returns `true`.
   - Once a handler matches, it executes `handle(message)`. Subsequent handlers in the chain do not receive the message.
   - Handler execution is wrapped in a per-message fault isolation boundary: an error thrown by one handler is caught, logged, and does not terminate the router or interrupt processing of subsequent batch messages.

3. **Lifecycle & Upsert Modes**:
   - The router coordinates `messages.upsert` subscriptions with `BaileysConnectionManager`.
   - Ingests both real-time `"notify"` and backlog `"append"` events. Individual handlers declare their supported modes declaratively on their interface.

### 2.3 Observable Catch-All Fallback Handler (`CatchAllLoggingHandler`)

To eliminate silent message dropping, a default fallback handler is registered at the very end of the priority chain:

```ts
export class CatchAllLoggingHandler implements WhatsAppMessageHandler {
	readonly name = "catch-all-logging";

	constructor(private readonly logger: LoggerPort) {}

	matches(_message: NormalizedWhatsAppMessage): boolean {
		return true; // Catches any message unmatched by earlier handlers
	}

	async handle(message: NormalizedWhatsAppMessage): Promise<void> {
		this.logger.debug("Unhandled incoming message ignored by catch-all fallback", {
			messageId: message.messageId,
			chatJid: message.chatJid,
			senderJid: message.senderJid,
			chatType: message.chatType,
			contentType: message.content.type,
		});
	}
}
```

### 2.4 Multi-Boundary Structured Logging Discipline

To ensure complete runtime observability and simplify incident triage, leveled structured logging is enforced across 5 explicit boundaries:

1. **Socket Ingestion Boundary (`BaileysConnectionManager`)**:
   - Logs `debug`: `"Received messages.upsert batch from Baileys"` with `{ type, messageCount }`.
2. **Normalization Boundary (`WhatsAppMessageNormalizer`)**:
   - On drop: Logs `debug`: `"Ignored invalid or self raw message"` with `{ messageId, fromMe, reason }`.
   - On success: Logs `debug`: `"Normalized incoming WhatsApp message"` with `{ messageId, chatJid, senderJid, chatType, contentType }`.
3. **Router Routing Boundary (`WhatsAppMessageRouter`)**:
   - On match: Logs `info` or `debug`: `"Routed incoming message to handler"` with `{ messageId, handler: handler.name, chatType }`.
4. **Handler Execution Boundary**:
   - Logs `debug`: `"Handler started message processing"` with `{ handler: handler.name, messageId }`.
   - On completion: Logs `debug`: `"Handler completed message processing"` with `{ handler: handler.name, messageId, durationMs }`.
   - On failure: Logs `error`: `"Handler failed during message processing"` with `{ handler: handler.name, messageId, error }`.
5. **Core Use Case Boundary**:
   - `HandleIncomingUserMessage`: Logs turn entry (`startedAt`), context retrieval summary, LLM reasoning completion, and storage confirmation (`completedAt`, `durationMs`).
   - `StageIncomingFoodAnnouncement`: Logs announcement extraction result, deduplication bypass, and database staging ID.

### 2.5 Subscriber Adapter Re-architecture

The driving adapters in `src/adapters/inbound/whatsapp/` are refactored into cohesive, focused subscribers implementing `WhatsAppMessageHandler`:

#### 2.5.1 `DirectMessageInboundAdapter` (replaces `WhatsAppInboundAdapter`)

- **Matcher**:
  - `message.fromMe === false`
  - `message.chatType === "direct"`
  - `message.content.type === "text"`
- **Workflow**:
  1. Authenticates sender via `AccessControlPort.authenticate(message.senderJid, message.companionLidJid)`.
  2. Discards and logs unauthorized/inactive senders.
  3. Maps `NormalizedWhatsAppMessage` + canonical `user.pnJid` to domain `UserMessage` entity.
  4. Delegates to `HandleIncomingUserMessage.execute(userMessage)`.

#### 2.5.2 `FoodAnnouncementInboundAdapter` (replaces `FoodAnnouncementsInboundAdapter`)

- **Matcher**:
  - `message.fromMe === false`
  - `message.chatType === "group"`
  - `message.chatJid === targetGroupJid`
  - `message.content.type !== "unsupported"` (accepts `"text" | "image" | "document"`)
- **Workflow**:
  1. Invokes `message.downloadMedia()` if the message is an image or document.
  2. Delegates to core use case `StageIncomingFoodAnnouncement.execute(...)`.

#### 2.5.3 Priority Ordering in Composition Root (`src/index.ts`)

```ts
router.register(adminCommandHandler); // Priority 1 (future: direct + text + admin + command prefix)
router.register(foodAnnouncementAdapter); // Priority 2 (group === targetGroupJid)
router.register(directMessageAdapter); // Priority 3 (direct + text catch-all)
router.register(new CatchAllLoggingHandler(logger)); // Priority 4 (terminal catch-all logger)
```

---

## 3. Core Domain & Port Harmonization

### 3.1 Use Case: `HandleIncomingUserMessage`

- **Location**: `src/core/use-cases/HandleIncomingUserMessage.ts` (renamed from `ProcessIncomingMessage.ts`).
- Orchestrates the atomic 4-phase interaction turn:
  1. Phase 1: Context Retrieval (`ContextRetrievalPort`)
  2. Phase 2: Reasoning Phase (`AgentLoop` domain service)
  3. Phase 3: Delivery Phase (`MessageSenderPort`)
  4. Phase 4: Persistence Phase (`DialogueTurnRepositoryPort`)

### 3.2 Use Case: `StageIncomingFoodAnnouncement`

- **Location**: `src/core/use-cases/StageIncomingFoodAnnouncement.ts`
- **Purity**: Zero external runtime dependencies; depends solely on `MessStagingRepositoryPort` and `LoggerPort`.
- **Input Contract**:
  ```ts
  export interface StageFoodAnnouncementCommand {
  	readonly id: string;
  	readonly senderAddress: string;
  	readonly senderAddressType: "pn" | "lid";
  	readonly messageType: "image" | "document" | "text";
  	readonly textBody: string | null;
  	readonly mediaMimeType: string | null;
  	readonly mediaBuffer: Buffer | null;
  }
  ```
- **Domain Logic**:
  1. Enforces validation rules (rejects missing sender or empty text/media combinations).
  2. Guarantees idempotent ingestion over reconnected message replays.
  3. Persists record via `stagingRepository.stageMessage({ ...command, status: "pending" })`.

### 3.3 Domain Service Classification: `AgentLoop`

- `AgentLoop` is moved from `src/core/use-cases/AgentLoop.ts` to `src/core/services/AgentLoop.ts`.
- Serves as a pure domain service representing the ReAct reasoning loop.
- Never called directly by external inbound adapters; invoked exclusively by use cases (`HandleIncomingUserMessage`).

### 3.4 Outbound Port & Adapter Renaming: `DialogueTurnRepositoryPort`

To eliminate the "Chat" terminology drift:

- `ChatRepositoryPort` $\rightarrow$ `DialogueTurnRepositoryPort` (`src/core/ports/DialogueTurnRepositoryPort.ts`).
- Directory: `src/adapters/outbound/chat-repository/` $\rightarrow$ `src/adapters/outbound/dialogue-turn-repository/`.
- `PostgresChatRepository` $\rightarrow$ `PostgresDialogueTurnRepository` (`src/adapters/outbound/dialogue-turn-repository/PostgresDialogueTurnRepository.ts`).
- `ChatRepositoryContextRetrievalAdapter` $\rightarrow$ `DialogueTurnContextRetrievalAdapter` (`src/adapters/outbound/context-retrieval/DialogueTurnContextRetrievalAdapter.ts`).
- Database table schema `dialogue_turns` and migration files remain intact without breaking schema changes.

---

## 4. Edge Cases & Invariant Enforcement

1. **Self-Message Loop Prevention**:
   - `NormalizedWhatsAppMessage.fromMe` is resolved directly from `WAMessageKey.fromMe`.
   - The normalizer marks bot-originated messages, and handlers reject them to prevent automated reply feedback loops.
2. **Missing Stanza Identity or Envelopes**:
   - Incoming payloads without `msg.key` or `msg.key.id` are discarded by the normalizer before reaching the router.
3. **Transport Disconnections during Lazy Media Download**:
   - `downloadMedia()` handles underlying Baileys socket closure or media expiration gracefully, logging a warning and returning `null` rather than throwing uncaught exceptions.
4. **Reconnection & Replay Deduplication**:
   - Offline message backlogs (`upsert.type === "append"`) replayed upon socket reconnection must not result in duplicate operational state.
   - `StageIncomingFoodAnnouncement` guarantees idempotent ingestion.
5. **Fault Isolation**:
   - An uncaught exception within a handler's `handle()` must not crash the router or block other messages within the same Baileys batch.

---

## 5. Hexagonal Placement & Architecture

```text
src/
├── core/
│   ├── entities/
│   │   └── DialogueTurn.ts                 # Domain entity & DialogueTurnFactory
│   ├── use-cases/
│   │   ├── HandleIncomingUserMessage.ts    # Renamed from ProcessIncomingMessage
│   │   └── StageIncomingFoodAnnouncement.ts # Extracted pure staging use case
│   ├── services/
│   │   └── AgentLoop.ts                    # Reclassified pure ReAct domain service
│   └── ports/
│       └── DialogueTurnRepositoryPort.ts   # Renamed from ChatRepositoryPort
├── adapters/
│   ├── inbound/
│   │   └── whatsapp/
│   │       ├── router/
│   │       │   ├── WhatsAppMessageNormalizer.ts # Raw Baileys -> NormalizedWhatsAppMessage
│   │       │   ├── WhatsAppMessageRouter.ts     # Ordered first-match dispatcher
│   │       │   ├── CatchAllLoggingHandler.ts   # Default terminal no-op logging handler
│   │       │   └── WhatsAppMessageHandler.ts   # Normalized message contract & handler interface
│   │       ├── DirectMessageInboundAdapter.ts   # 1-on-1 AI dialogue driving adapter
│   │       └── FoodAnnouncementInboundAdapter.ts # Group announcement staging adapter
│   └── outbound/
│       ├── dialogue-turn-repository/       # Renamed from chat-repository/
│       │   ├── postgres/
│       │   │   ├── schema.ts               # dialogue_turns table schema
│       │   │   ├── validation.ts           # Turn structural & temporal invariants
│       │   │   ├── metadata.ts             # Relational envelope metadata extractor
│       │   │   ├── migrator.ts             # Startup Drizzle migration runner
│       │   │   └── PostgresDialogueTurnRepository.ts # Renamed from PostgresChatRepository
│       ├── context-retrieval/
│       │   └── DialogueTurnContextRetrievalAdapter.ts # Renamed from ChatRepositoryContextRetrievalAdapter
│       └── whatsapp/
│           └── BaileysConnectionManager.ts # Low-level socket lifecycle
```

- **Inward Boundary Isolation**: `WhatsAppMessageRouter` and `WhatsAppMessageHandler` live exclusively within `src/adapters/inbound/whatsapp/router/`. No router interface or Baileys type leaks into `src/core/`.
- **Constitution Compliance**:
  - `src/core/` maintains zero external runtime dependencies.
  - Every production file strictly adheres to the 150-line file limit and 40-line function limit.
  - No dummy wrappers: each use case represents a multi-step business workflow.
  - Dependencies are uniformly injected via constructors.
