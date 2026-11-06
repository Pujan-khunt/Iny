# Inbound Message Observability and Log Enrichment Specification

## 1. Problem Statement & Motivation

During local development and operational monitoring, inbound WhatsApp messages and food announcement processing lack sufficient visibility in application runtime logs:

1. **Missing Message Content in Logs**:
   - `WhatsAppMessageNormalizer`, `WhatsAppMessageRouter`, and `CatchAllLoggingHandler` currently log only `messageId`, `chatJid`, and `chatType`.
   - The actual payload content—text body, media captions, or document file names—is omitted. Neither human operators nor autonomous AI agents can correlate log events with actual user or admin actions without manual database queries.

2. **Opaque "Unsupported" Messages in Catch-All**:
   - Messages that fail to match recognized formats (e.g. wrapped in future-proof envelopes, polls, or reaction stanzas) are classified as `contentType: "unsupported"` and routed to `CatchAllLoggingHandler`.
   - `CatchAllLoggingHandler` logs only at `debug` level (making it silent under default log levels) and does not log the raw protobuf message keys (e.g. `groupMentionedMessage`, `pollCreationMessage`, `reactionMessage`). Consequently, when an announcement or message is ignored, the logs provide zero diagnostic clues about what WhatsApp stanza structure arrived.

3. **Silent Handler Match Rejections**:
   - Handlers like `FoodAnnouncementInboundAdapter` reject messages silently during `matches()` predicate checks (e.g. bot-authored messages, wrong group, unsupported content type, empty text). There is no diagnostic tracing to explain why a message in a monitored conversation was skipped.

4. **AI Agent Operability**:
   - Autonomous debugging agents inspecting logs via `scripts/inspect-logs.ts` cannot deduce message intent or diagnose routing issues because message content is absent from log payloads.

---

## 2. Requirements & Core Capabilities

### 2.1 Content Preview Generation

1. **Content Preview Contract**:
   - A unified preview extraction mechanism must generate a sanitized, single-line string representation of every message's content:
     - **Text Messages**: Full text if length is $< 500$ characters. If length is $\ge 500$ characters, the first 500 characters followed by `... [truncated]`.
     - **Image Messages**: Caption (full text up to 500 characters, truncated if $\ge 500$), or `"[image without caption]"` if caption is null/empty; alongside `mimeType`.
     - **Document Messages**: `"[document: <fileName>]"` and caption (up to 500 characters), alongside `mimeType`.
     - **Unsupported Messages**: `"[unsupported]"` accompanied by the list of top-level raw message keys (e.g. `rawKeys: ["groupMentionedMessage"]`).
   - Line breaks and multi-space formatting in previews must be normalized (newlines replaced with spaces) to ensure single-line readability in structured JSON logs and CLI outputs.

### 2.2 Enriched Normalized Message Envelope

`NormalizedWhatsAppMessage` content types must be enriched to preserve preview information and raw envelope diagnostic keys:

```typescript
export interface WhatsAppContentBase {
	readonly type: WhatsAppContentType;
	readonly text: string | null;
	readonly mimeType: string | null;
	readonly preview: string;
}

export type WhatsAppContent =
	| (WhatsAppContentBase & {
			readonly type: "text";
			readonly text: string;
			readonly mimeType: null;
	  })
	| (WhatsAppContentBase & {
			readonly type: "image";
			readonly text: string | null;
			readonly mimeType: string;
	  })
	| (WhatsAppContentBase & {
			readonly type: "document";
			readonly text: string | null;
			readonly mimeType: string;
	  })
	| (WhatsAppContentBase & {
			readonly type: "unsupported";
			readonly text: null;
			readonly mimeType: null;
			readonly rawKeys: readonly string[];
	  });
```

### 2.3 Catch-All Handler Observability

1. **Elevate Log Level**:
   - Change `CatchAllLoggingHandler` logging level from `debug` to **`info`**.
2. **Structured Metadata**:
   - The log entry for unhandled messages must include:
     - `messageId`
     - `chatJid`
     - `senderJid`
     - `chatType`
     - `contentType`
     - `contentPreview`
     - `rawKeys` (present when `contentType === "unsupported"`)
     - `fromMe`
     - `upsertType`

### 2.4 Router Dispatch Logging

1. **Handler Dispatch**:
   - In `WhatsAppMessageRouter.executeHandler`, include `contentPreview` and `contentType` in the `info` log:
     ```json
     {
     	"level": 30,
     	"module": "router",
     	"messageId": "...",
     	"handler": "food-announcement",
     	"chatType": "group",
     	"contentType": "text",
     	"contentPreview": "Tomorrow lunch will be..."
     }
     ```
2. **Duplicate Stanza Logging**:
   - Retain `debug` level for duplicate drops but include `contentPreview` if available.

### 2.5 Normalizer Logging

- In `WhatsAppMessageNormalizer`, enrich the `Normalized incoming WhatsApp message` log entry to include:
  - `contentType`
  - `senderJid`
  - `contentPreview`

### 2.6 Handler Diagnostics in Target Chats

- In `FoodAnnouncementInboundAdapter`:
  - When a message arrives in `targetGroupJid` but is not handled, log a diagnostic event at `debug` level with the failure reason (e.g. `reason: "from_me"`, `reason: "unsupported_content_type"`, `reason: "empty_text"`), accompanied by `contentPreview` and `rawKeys`.
- In `DirectMessageInboundAdapter`:
  - When a direct message is ignored due to access control, log at `info` with `senderJid`, `messageId`, and `contentPreview`.

---

## 3. Boundary Contracts & Invariants

1. **Line and Function Limits**:
   - Every modified or created file must strictly conform to Constitution rules ($\le 150$ lines/file, $\le 40$ lines/function, max nesting depth 3).
2. **Hexagonal Architecture Purity**:
   - All logging adaptations remain within `src/adapters/inbound/whatsapp/` and existing `LoggerPort` interfaces. No external dependencies introduced into `src/core/`.
3. **Log Sanitization**:
   - Previews must truncate long inputs to 500 characters to prevent buffer bloat while preserving full readability of typical announcements and queries.

---

## 4. Test & Verification Plan

1. **Unit Tests**:
   - `WhatsAppMessageContentExtractor.test.ts`: Verify that `preview` is generated correctly for text ($< 500$ chars, $\ge 500$ chars with truncation, multi-line normalization), images (with and without caption), documents, and unsupported types (`rawKeys` extraction).
   - `CatchAllLoggingHandler.test.ts`: Verify that unhandled messages log at `info` level with `contentPreview` and `rawKeys`.
   - `WhatsAppMessageRouter.test.ts`: Verify that router dispatch logs include `contentPreview` and `contentType`.
   - `FoodAnnouncementInboundAdapter.test.ts`: Verify that messages in the target group that fail predicate emit diagnostic logs with `reason`.
2. **Full Pipeline Verification**:
   - Run `npm run check:all` (Prettier, ESLint, deadcode analysis, TypeScript typecheck, Vitest).
   - Run `FOOD_INGESTION_TEST_DATABASE_URL=... npm test tests/integration/FoodIngestionTransactions.test.ts`.
