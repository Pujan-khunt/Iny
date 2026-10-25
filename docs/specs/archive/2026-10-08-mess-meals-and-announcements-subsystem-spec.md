# Specification: Mess Meals & Real-Time Announcements Subsystem

**Status:** Draft (Pending Human Review Gate)  
**Date:** 2026-10-08  
**Authors:** Pujan Khunt, Antigravity AI

---

## 1. Context & Business Motivations

Iny operates as an intelligent WhatsApp personal assistant engine for college students. One of the highest-frequency, mission-critical daily needs on campus is answering questions about food:

- _"What's for lunch today?"_
- _"Where is lunch for batch 2028?"_
- _"Is dinner timing extended tonight?"_
- _"What is being served at TCB right now?"_

The college food ecosystem operates across three vendors with heterogeneous publishing cadences and formats:

1. **Cheftalk Regular**: Publishes weekly menus as digital vector PDFs (Sunday through Saturday).
2. **Cheftalk Jain**: Publishes weekly menus as digital vector PDFs.
3. **The Craving Brew (TCB / Uniworld)**: Publishes weekly menus as image photos.
4. **Food Committee WhatsApp Group**: An official admin-only group broadcasting daily operational exceptions:
   - Daily lunch seating allocations (_"Tomorrow lunch in college for all except 2027, 2028, 2029 A (hostel)"_).
   - Meal timing extensions (_"Dinner extended till 11:00 PM due to Fest"_).
   - Dish substitutions and additions (_"Paneer replaced with Mix Veg today"_).

### Core Problems Addressed by This Specification

1. **The RAG Hallucination Trap**: Pure unstructured vector retrieval (RAG) fails on meal queries—it struggles with exact calendar dates, aggregates, and subtle dish substitutions.
2. **The "Silent Omission" Bug**: Querying menus and announcements separately risks the agent sending a stale base menu without knowing an override took place.
3. **Mobile Formatting Drift**: LLMs default to conversational pleasantries, Markdown heading syntax (`###`), and double asterisks (`**bold**`), which render incorrectly on WhatsApp mobile.
4. **Autonomous Vision Ingestion Fragility**: Fully automated extraction pipelines can silently corrupt production database tables on unparsed images or informal texts.
5. **High Latency on Simple Lookups**: Running a standard 2-turn ReAct loop (Turn 1: decide tool call $\rightarrow$ Turn 2: copy tool string) takes ~2.0s. For 95% of queries, this second turn is pure waste.

This specification designs an **end-to-end deterministic subsystem**: an append-only staging mailbox in PostgreSQL, human-directed CLI extraction pipelines, four strictly typed meal-scoped tables, unified parallel retrieval, and first-class early termination in Iny's `AgentLoop`.

---

## 2. Architectural Boundaries & Hexagonal Invariants

Following Iny's Hexagonal Architecture:

- **Core Domain (`src/core/`)**:
  - `src/core/entities/MessMeal.ts`: Pure domain entities (`ResolvedMealInfo`, `MessMeal`, `MessMealLocationDetail`, `MessMealTimingExtension`, `MessMealChange`).
  - `src/core/ports/MessRepositoryPort.ts`: Outbound port defining unified parallel read operations (`getResolvedMeal`).
  - `src/core/ports/ToolRegistryPort.ts`: Enhanced with strictly required `ToolResult { content: string; isTerminal: boolean; }`.
  - `src/core/use-cases/AgentLoop.ts`: Implements the **All-or-Nothing Early Termination Rule** and injects temporal grounding (`userMessage.timestamp` in `Asia/Kolkata`) into the dynamic system prompt per turn.
- **Outbound Adapters (`src/adapters/outbound/`)**:
  - `src/adapters/outbound/mess/postgres/schema.ts`: Drizzle ORM schema defining 4 operational tables and 1 staging table.
  - `src/adapters/outbound/mess/postgres/PostgresMessRepository.ts`: Driven adapter implementing `MessRepositoryPort` executing 4 parallel index-backed point queries via `Promise.all`.
  - `src/adapters/outbound/tool-registry/InMemoryToolRegistry.ts`: Implements `ToolRegistryPort` returning strongly-typed `ToolResult`s.
- **Inbound Adapters (`src/adapters/inbound/`)**:
  - `src/adapters/inbound/whatsapp/FoodAnnouncementsInboundAdapter.ts`: Baileys event subscriber listening to `messages.upsert`, filtering for `FOOD_ANNOUNCEMENTS_GROUP_JID`, ignoring `fromMe` messages, and saving raw message payloads and binary media (`bytea`) into `whatsapp_group_food_announcements_messages` via `onConflictDoNothing()`.
- **Tools Layer (`src/tools/`)**:
  - `src/tools/DisplayMessCardTool.ts`: Terminal tool (`isTerminal: true`) rendering the Compact Multi-Vendor Digest with Next-Upcoming-Meal Rollover logic.
  - `src/tools/QueryMessDetailsTool.ts`: Non-terminal tool (`isTerminal: false`) returning structured facts for multi-turn conversational reasoning.
  - `src/tools/BaseTool.ts`: Updated to enforce `ToolResult` on `run()`.
  - `CalculatorTool` Decommissioning: `src/tools/CalculatorTool.ts` and `tests/tools/CalculatorTool.test.ts` are permanently removed to eliminate prompt bloat, token waste, and tool hallucination.
- **Configuration & Infrastructure**:
  - `src/config.ts`: Enforces strictly required `FOOD_ANNOUNCEMENTS_GROUP_JID: z.string().trim().regex(/^.+@g\.us$/)` under the Zero-Trust principle.
  - `drizzle.config.ts`: Explicitly registers `'./src/adapters/outbound/mess/postgres/schema.ts'` in its `schema` array for migration discovery.
- **Composition Root (`src/index.ts`)**:
  - Sole location responsible for instantiating `PostgresMessRepository`, registering `DisplayMessCardTool` and `QueryMessDetailsTool` (replacing `CalculatorTool`), and subscribing `FoodAnnouncementsInboundAdapter` to `BaileysConnectionManager`.

---

## 3. Database Schema: PostgreSQL + Drizzle ORM

All tables live in `src/adapters/outbound/mess/postgres/schema.ts`.
`drizzle.config.ts` explicitly includes this file in its `schema` array:

```typescript
schema: [
  './src/adapters/outbound/chat-repository/postgres/schema.ts',
  './src/adapters/outbound/whatsapp/postgres/schema.ts',
  './src/adapters/outbound/access-control/postgres/schema.ts',
  './src/adapters/outbound/mess/postgres/schema.ts',
],
```

### 3.1 Shared Domain Enums

```typescript
import {
	customType,
	date,
	index,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

export const mealSlotEnum = pgEnum("meal_slot", ["breakfast", "lunch", "dinner"]);
export const vendorEnum = pgEnum("vendor", ["cheftalk_regular", "cheftalk_jain", "tcb"]);
export const mealChangeTypeEnum = pgEnum("meal_change_type", [
	"replacement",
	"addition",
	"cancellation",
]);

export type MealSlot = (typeof mealSlotEnum.enumValues)[number];
export type Vendor = (typeof vendorEnum.enumValues)[number];
export type MealChangeType = (typeof mealChangeTypeEnum.enumValues)[number];
```

### 3.2 Table 1: `mess_meals` (Planned Weekly Base Menus)

Stores the scheduled ground truth extracted from weekly PDFs and images.

```typescript
export const messMeals = pgTable(
	"mess_meals",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		mealDate: date("meal_date", { mode: "string" }).notNull(),
		mealSlot: mealSlotEnum("meal_slot").notNull(),
		vendor: vendorEnum("vendor").notNull(),
		items: text("items").array().notNull(), // Strictly required
		sourceMessageId: text("source_message_id"), // WAMID of originating staging message (for surgical rollback & audit)
		ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("idx_mess_meals_slot").on(table.mealDate, table.mealSlot, table.vendor),
		index("idx_mess_meals_source_msg").on(table.sourceMessageId),
	],
);
```

### 3.3 Table 2: `mess_meal_location_details` (Daily Seating Allocations)

Stores daily lunch seating plans. Exactly one row permitted per `(meal_date, meal_slot)`.

```typescript
export const messMealLocationDetails = pgTable(
	"mess_meal_location_details",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		mealDate: date("meal_date", { mode: "string" }).notNull(),
		mealSlot: mealSlotEnum("meal_slot").notNull().default("lunch"),
		hostelBatches: text("hostel_batches").array().notNull(),
		collegeBatches: text("college_batches").array().notNull(),
		sourceMessageId: text("source_message_id"), // WAMID of originating staging message
		ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("idx_mess_location_unique_slot").on(table.mealDate, table.mealSlot),
		index("idx_mess_location_source_msg").on(table.sourceMessageId),
	],
);
```

- **Edge Case Invariants**:
  - _All in Hostel_: `hostelBatches = ['ALL_BATCHES']`, `collegeBatches = []`.
  - _All in College_: `hostelBatches = []`, `collegeBatches = ['ALL_BATCHES']`.
  - _Split Seating_: `hostelBatches = ['2027', '2028', '2029 A']`, `collegeBatches = ['ALL_OTHER_BATCHES']`.

### 3.4 Table 3: `mess_meal_timing_extensions` (Meal Closing Shifts)

Stores ad-hoc schedule extensions.

```typescript
export const messMealTimingExtensions = pgTable(
	"mess_meal_timing_extensions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		mealDate: date("meal_date", { mode: "string" }).notNull(),
		mealSlot: mealSlotEnum("meal_slot").notNull(),
		targetVendor: vendorEnum("target_vendor"), // Nullable: null means campus-wide
		extendedTimings: text("extended_timings").notNull(), // e.g. "Extended till 11:00 PM"
		sourceMessageId: text("source_message_id"), // WAMID of originating staging message
		ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_mess_timing_lookup").on(table.mealDate, table.mealSlot),
		index("idx_mess_timing_source_msg").on(table.sourceMessageId),
	],
);
```

### 3.5 Table 4: `mess_meal_changes` (Dishes, Additions, Cancellations)

Stores dish substitutions, additions, or cancellations. Always vendor-specific.

```typescript
export const messMealChanges = pgTable(
	"mess_meal_changes",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		mealDate: date("meal_date", { mode: "string" }).notNull(),
		mealSlot: mealSlotEnum("meal_slot").notNull(),
		targetVendor: vendorEnum("target_vendor").notNull(),
		changeType: mealChangeTypeEnum("change_type").notNull(),
		affectedItem: text("affected_item").notNull(),
		originalItem: text("original_item"), // Nullable: populated for replacements
		sourceMessageId: text("source_message_id"), // WAMID of originating staging message
		ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_mess_meal_changes_lookup").on(table.mealDate, table.mealSlot, table.targetVendor),
		index("idx_mess_changes_source_msg").on(table.sourceMessageId),
	],
);
```

### 3.6 Table 5: `whatsapp_group_food_announcements_messages` (Staging Inbox Buffer)

Stores incoming WhatsApp broadcasts passively captured from the official _"Food Announcements"_ group.

```typescript
// Custom type for PostgreSQL bytea binary buffers
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType() {
		return "bytea";
	},
});

export const whatsappGroupFoodAnnouncementsMessages = pgTable(
	"whatsapp_group_food_announcements_messages",
	{
		id: text("id").primaryKey(), // WhatsApp message ID (wamid)
		senderAddress: text("sender_address").notNull(), // Handles both PN (@s.whatsapp.net) and LID (@lid)
		senderAddressType: text("sender_address_type").notNull(), // 'pn' | 'lid' via WhatsAppJid classification
		messageType: text("message_type").notNull(), // 'text' | 'image' | 'document'
		textBody: text("text_body"),
		mediaBuffer: bytea("media_buffer"), // Stored directly in Postgres bytea (stateless)
		mediaMimeType: text("media_mime_type"), // Native Protobuf mimetype (e.g. 'application/pdf', 'image/jpeg')
		status: text("status").notNull().default("pending"), // 'pending' | 'processed' | 'ignored'
		receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
		processedAt: timestamp("processed_at", { withTimezone: true }),
	},
	(table) => [index("idx_wa_food_group_status_received").on(table.status, table.receivedAt.desc())],
);
```

---

## 4. Ingestion Pipeline & CLI Triage Engine

### 4.1 Inbound Eavesdropping Hook (`FoodAnnouncementsInboundAdapter`)

- Subscribes to Baileys `messages.upsert` via `connectionManager.subscribe('messages.upsert', handler)`.
- If `msg.key.remoteJid === config.FOOD_ANNOUNCEMENTS_GROUP_JID`:
  - **Bot Self-Message Rejection**: If `msg.key.fromMe === true`, silently returns to avoid ingesting bot-originated broadcasts.
  - **Sender Classification**: Reads `msg.key.participant ?? msg.participant`. Uses `WhatsAppJid.normalize` to record `senderAddress` and classifies `senderAddressType` as `'pn'` or `'lid'`.
  - **Protobuf Inspection via `normalizeMessageContent`**:
    - If `unwrapped.imageMessage`: `messageType = 'image'`, `mediaMimeType = unwrapped.imageMessage.mimetype`, `textBody = caption`.
    - If `unwrapped.documentMessage`: `messageType = 'document'`, `mediaMimeType = unwrapped.documentMessage.mimetype`, `textBody = caption ?? fileName`.
    - If `unwrapped.conversation || unwrapped.extendedTextMessage`: `messageType = 'text'`, `mediaMimeType = null`, `textBody = text`.
  - If image or document: streams binary bytes via Baileys `downloadMediaMessage` into Node.js `Buffer`.
  - **Idempotent Staging Insertion**: Inserts row into `whatsapp_group_food_announcements_messages` using `.onConflictDoNothing()`. If Baileys re-delivers an existing message on socket reconnection, PostgreSQL silently ignores the collision on primary key `id`.
  - Silently returns without sending any reply to the group.

### 4.2 Interactive CLI Controller (`npm run ingest`)

Interactive terminal utility operating over `whatsapp_group_food_announcements_messages`:

#### CLI Flags & Options

The CLI accepts customizable arguments for flexible query scoping:

- **`--limit <K>` / `-k <K>`**: Number of recent messages to retrieve (defaults to `10`). Example: `npm run ingest -- --limit 20`
- **`--date <YYYY-MM-DD>` / `-d <YYYY-MM-DD>`**: Filters messages received on a specific calendar date (IST). Example: `npm run ingest -- --date 2026-10-08`
- Both flags can be combined: `npm run ingest -- -d 2026-10-08 -k 5`

#### Execution Workflow

1. Queries `whatsapp_group_food_announcements_messages` applying the `--date` filter (if provided) and `--limit` (defaults to 10), ordered by `received_at DESC`.
2. Formats an interactive list displaying index `[1-K]`, timestamp (IST), sender address (`pn` vs `lid`), message type (`text`, `image`, `document`), and text preview snippet.
3. Prompts user to select message index `[1-K]` and specify **Intent Action**:
   - `[1] Weekly Menu`
   - `[2] Location Detail`
   - `[3] Timing Extension`
   - `[4] Meal Change`
   - `[5] Mark Ignored`

#### Mandatory Pre-Extraction Inspection & Confirmation

Before triggering any multimodal or LLM extraction pipeline (preventing accidental API usage or wrong message selection), the CLI renders the raw staged message details:

```text
========================================================================================
🔍 MESSAGE INSPECTION & CONFIRMATION
========================================================================================
Message ID:     3EB0A1B2C3D4E5F6
Sender:         +919876543210 (pn)
Received At:    2026-10-08 11:42:15 IST
Message Type:   document (application/pdf, 123 KB)
File / Caption: "WEEKLY MENU OCT 4-10-3.pdf"
Full Text Body: [None / Extracted filename]
Selected Action:[1] Weekly Menu
========================================================================================
Actions:
  [y] Proceed with Extraction
  [o] Open Media (writes mediaBuffer to temp file and launches native viewer via xdg-open/open)
  [c] Cancel / Back to List
Choice [y/o/c]:
```

If `[o]` is selected, the CLI opens the native viewer (e.g. Evince, Preview) so the operator can inspect the document locally before confirming. If confirmed `[y]`, the CLI runs the respective extraction engine.

#### Non-Fatal Extraction Error Recovery

If an external API or network error occurs during extraction (HTTP 429 rate limit, 503 overload, network timeout, or schema parsing failure), the CLI catches the exception without terminating the Node.js process:

```text
========================================================================================
❌ EXTRACTION ENCOUNTERED AN ERROR
========================================================================================
Error Type:    LLMRateLimitError (HTTP 429)
Error Details: "Rate limit reached for deepseek-flash. Please wait 5s."
Target Message:3EB0A1B2C3D4E5F6
Staging State: UNCHANGED (message remains 'pending' in database)
========================================================================================
Actions:
  [r] Retry Extraction (immediately re-attempts extraction on this message)
  [c] Cancel & Return to Message List
Choice [r/c]:
```

The staging message safely remains `pending` until an extraction succeeds and is confirmed.

### 4.3 Extraction Engine Implementations

1. **Weekly Menu Engine**:
   - **Cheftalk (PDF)**:
     - Rasterizes Page 1 to PNG using native `pdftoppm` (`poppler-utils`) at 300 DPI (configurable, e.g. `dpi: number = 300`) via a temporary file process (`execFileAsync('pdftoppm', ['-png', '-r', String(dpi), '-singlefile', ...])`). Empirical testing confirmed 300 DPI produces superior font clarity for dense table cells at only ~278 KB file size.
     - Extracts digital text tokens via `pdf-parse` / `unpdf`.
     - Passes both the PNG image and embedded text tokens to DeepSeek V4.1 Flash multimodal API.
   - **TCB (Image)**:
     - Sends binary image buffer directly to DeepSeek V4.1 Flash with a 2-step transcription scratchpad prompt.
   - **Output Validation**: Validates against `ExtractedWeeklyMenuSchema` containing exactly 21 `(mealDate, mealSlot, items[])` entries (7 days × 3 slots: `breakfast`, `lunch`, `dinner`). No snacks category exists in the system.
     - **Strict ISO Date Format Invariant**: `mealDate` is validated via strict regex `z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be ISO YYYY-MM-DD')`. The extraction prompt strictly instructs: _"Convert all calendar dates into ISO YYYY-MM-DD (e.g. 2026-10-04). Never use DD/MM/YYYY or text month names."_
2. **Location Seating Engine**:
   - Parses `textBody` relative to message `receivedAt`. Extracts `mealDate`, `hostelBatches`, and `collegeBatches`.
3. **Timing Extension Engine**:
   - Parses `textBody` relative to message `receivedAt`. Extracts `mealDate`, `mealSlot`, `targetVendor` (nullable), and `extendedTimings`.
4. **Meal Change Engine**:
   - Parses `textBody`. Extracts `mealDate`, `mealSlot`, `targetVendor`, `changeType`, `affectedItem`, and `originalItem`.

### 4.4 Atomic Review, Remediation & Commit Ritual

The default editor for interactive manual editing is `vim` (resolving `process.env.VISUAL || process.env.EDITOR || 'vim'`).

#### Preview 1: Weekly Menu Extraction (21 Meals)

```text
========================================================================================
📋 WEEKLY MENU EXTRACTION PREVIEW
========================================================================================
Vendor:         cheftalk_regular (Detected from document title)
Date Range:     2026-10-04 (Sun) ➔ 2026-10-10 (Sat) [7 Days]
Total Slots:    21 meals (7 Breakfast, 7 Lunch, 7 Dinner)
Total Dishes:   112 items

Sanity Checks:  ✅ Contiguous 7-day span (Verified via UTC epoch: 86,400,000 ms/day)
                ✅ All 3 slots present per day
                ⚠️ WARNING: Dinner on 2026-10-06 has 0 items (is it fasting/holiday?)
----------------------------------------------------------------------------------------
📅 2026-10-04 (Sunday)
  • Breakfast [4 items]: Aloo Paratha, Curd, Pickle, Tea / Coffee
  • Lunch     [6 items]: Paneer Butter Masala, Dal Tadka, Jeera Rice, Chapati, Salad, Gulab Jamun
  • Dinner    [5 items]: Mix Veg Curry, Dal Fry, Steamed Rice, Phulka, Kheer

📅 2026-10-05 (Monday)
  • Breakfast [4 items]: Idli, Sambar, Coconut Chutney, Tea / Coffee
  • Lunch     [6 items]: Rajma Masala, Aloo Jeera, Steamed Rice, Chapati, Boondi Raita, Salad
  • Dinner    [5 items]: Palak Paneer, Dal Makhani, Jeera Rice, Tandoori Roti, Custard

... [Days 2026-10-06 to 2026-10-10 displayed in identical clean format] ...
========================================================================================
Database Action:
  • Upsert 21 rows into 'mess_meals' on conflict (meal_date, meal_slot, vendor) DO UPDATE
  • Update staging message status = 'processed'
========================================================================================
Actions:
  [y] Confirm & Commit to Database
  [v] Switch Vendor (current: cheftalk_regular ➔ [1] regular, [2] jain, [3] tcb)
  [d] Shift Dates (enter new start date, e.g. if LLM shifted Sun ➔ Mon)
  [e] Edit in vim (opens extracted JSON in vim, re-validates schema on save)
  [c] Cancel & Abort
Choice [y/v/d/e/c]:
```

#### Preview 2: Location Seating Allocation (`mess_meal_location_details`)

```text
========================================================================================
📍 LUNCH SEATING ALLOCATION PREVIEW
========================================================================================
Message Timestamp: 2026-10-08 11:42 AM IST
Target Meal Date:  2026-10-08 (Thursday)
Target Meal Slot:  lunch

🏢 Hostel Mess (Cheftalk Regular & Jain):
   Allocated Batches: UG1, UG2, PG1, PhD (All non-college batches)

🏫 College Mess (TCB):
   Allocated Batches: UG3, UG4, PG2
========================================================================================
Database Action:
  • Upsert 1 row into 'mess_meal_location_details' on conflict (meal_date, meal_slot) DO UPDATE
  • Update staging message status = 'processed'
========================================================================================
Actions:
  [y] Confirm & Commit
  [d] Change Date (current: 2026-10-08)
  [e] Edit Batches in vim
  [c] Cancel
Choice [y/d/e/c]:
```

#### Preview 3: Timing Extension (`mess_meal_timing_extensions`)

```text
========================================================================================
⏰ MEAL TIMING EXTENSION PREVIEW
========================================================================================
Message Timestamp: 2026-10-08 09:15 PM IST
Target Meal Date:  2026-10-08 (Thursday)
Target Meal Slot:  dinner
Target Vendor:     All Vendors (Global)
Extended Timings:  "Extended until 10:45 PM due to college fest"
========================================================================================
Database Action:
  • Insert 1 row into 'mess_meal_timing_extensions'
  • Update staging message status = 'processed'
========================================================================================
Actions:
  [y] Confirm & Commit
  [v] Assign to specific vendor (current: ALL ➔ [1] regular, [2] jain, [3] tcb)
  [c] Cancel
Choice [y/v/c]:
```

#### Preview 4: Meal Change (`mess_meal_changes`)

```text
========================================================================================
🍲 MEAL CHANGE / REPLACEMENT PREVIEW
========================================================================================
Message Timestamp: 2026-10-08 12:30 PM IST
Target Meal Date:  2026-10-08 (Thursday)
Target Meal Slot:  lunch
Target Vendor:     cheftalk_regular
Change Type:       REPLACEMENT

Original Dish:     Paneer Butter Masala
New / Replaced:    Kadai Paneer
========================================================================================
Database Action:
  • Insert 1 row into 'mess_meal_changes'
  • Update staging message status = 'processed'
========================================================================================
Actions:
  [y] Confirm & Commit
  [t] Change Type (current: REPLACEMENT ➔ [1] replacement, [2] addition, [3] cancellation)
  [c] Cancel
Choice [y/t/c]:
```

#### Preview 5: Ignore Message

```text
========================================================================================
🚫 IGNORE STAGED MESSAGE
========================================================================================
Message ID: 3EB0A1B2C3D4E5F6
Sender:     +919876543210 (pn)
Received:   2026-10-08 08:30 AM IST
Type:       text
Snippet:    "Good morning everyone, please note..."
========================================================================================
Database Action:
  • Update 'whatsapp_group_food_announcements_messages' SET status = 'ignored'
========================================================================================
Actions:
  [y] Confirm Ignore | [c] Cancel
Choice [y/c]:
```

#### Atomic Commit Execution

Upon `[y]` confirmation, writes are executed inside a single `db.transaction`:

1. Upserts/inserts into the operational table (`mess_meals`, `mess_meal_location_details`, `mess_meal_timing_extensions`, or `mess_meal_changes`), recording `sourceMessageId = message.id`.
2. Updates `whatsapp_group_food_announcements_messages` setting `status = 'processed'` (or `'ignored'`) and `processedAt = new Date()`.

#### Surgical Rollback ("Undo" Action for Processed Messages)

If an operator selects a message in `npm run ingest` that is already marked `status: 'processed'`, the CLI displays the processed status and offers a surgical rollback:

```text
========================================================================================
⚠️ PROCESSED MESSAGE ACTIONS
========================================================================================
Message ID:   3EB0A1B2C3D4E5F6
Sender:       +919876543210 (pn)
Processed At: 2026-10-09 11:45:00 IST
Associated:   Rows linked via 'source_message_id'
========================================================================================
Actions:
  [u] Undo / Revert Ingestion (deletes linked operational rows & resets status to 'pending')
  [c] Cancel / Back to List
Choice [u/c]:
```

Upon `[u]` confirmation, executes atomically inside `db.transaction`:

1. `DELETE FROM mess_meals WHERE source_message_id = message.id;`
2. `DELETE FROM mess_meal_location_details WHERE source_message_id = message.id;`
3. `DELETE FROM mess_meal_timing_extensions WHERE source_message_id = message.id;`
4. `DELETE FROM mess_meal_changes WHERE source_message_id = message.id;`
5. `UPDATE whatsapp_group_food_announcements_messages SET status = 'pending', processed_at = NULL WHERE id = message.id;`

The message is immediately restored to the active pending triage inbox without affecting any other messages.

### 4.5 Development Reset Utility (`npm run mess:reset`) with Strict Production Guards

A dedicated CLI script for rapidly clearing operational tables and resetting staging messages to a clean slate during local development and testing.

#### Multi-Layer Production Safety Guards:

1. **Environment Gate**: If `process.env.NODE_ENV === 'production'`, the script aborts immediately with a fatal error: _"Refusing to run destructive reset in production environment."_
2. **Host Inspection & Masked Display**: The script parses `DATABASE_URL` and explicitly prints the target host and database name:
   ```text
   ⚠️ TARGET DATABASE: postgres://...@localhost:5432/iny_dev
   ```
3. **Explicit Name Challenge**: Requires the operator to type the exact database name to confirm before proceeding:
   ```text
   Type the database name "iny_dev" to confirm wipe:
   ```

Upon matching confirmation, atomically executes:

1. `TRUNCATE TABLE mess_meals, mess_meal_location_details, mess_meal_timing_extensions, mess_meal_changes CASCADE;`
2. `UPDATE whatsapp_group_food_announcements_messages SET status = 'pending', processed_at = NULL;`

---

## 5. Domain Repository & Parallel Query Execution

### 5.1 Domain Entities (`src/core/entities/MessMeal.ts`)

100% pure TypeScript with zero external runtime dependencies:

```typescript
export type MealSlot = "breakfast" | "lunch" | "dinner";
export type Vendor = "cheftalk_regular" | "cheftalk_jain" | "tcb";
export type MealChangeType = "replacement" | "addition" | "cancellation";

/** Base planned meal entity */
export interface MessMeal {
	readonly id: string;
	readonly mealDate: string; // 'YYYY-MM-DD'
	readonly mealSlot: MealSlot;
	readonly vendor: Vendor;
	readonly items: readonly string[];
	readonly sourceMessageId?: string | null;
	readonly ingestedAt: Date;
}

/** Lunch seating allocation */
export interface MessMealLocationDetail {
	readonly id: string;
	readonly mealDate: string;
	readonly mealSlot: MealSlot;
	readonly hostelBatches: readonly string[];
	readonly collegeBatches: readonly string[];
	readonly sourceMessageId?: string | null;
	readonly ingestedAt: Date;
}

/** Timing extension */
export interface MessMealTimingExtension {
	readonly id: string;
	readonly mealDate: string;
	readonly mealSlot: MealSlot;
	readonly targetVendor: Vendor | null;
	readonly extendedTimings: string;
	readonly sourceMessageId?: string | null;
	readonly ingestedAt: Date;
}

/** Live dish substitution/addition/cancellation */
export interface MessMealChange {
	readonly id: string;
	readonly mealDate: string;
	readonly mealSlot: MealSlot;
	readonly targetVendor: Vendor;
	readonly changeType: MealChangeType;
	readonly affectedItem: string;
	readonly originalItem: string | null;
	readonly sourceMessageId?: string | null;
	readonly ingestedAt: Date;
}

/** Composite aggregate returned by MessRepositoryPort */
export interface ResolvedMealInfo {
	readonly mealDate: string;
	readonly mealSlot: MealSlot | null; // Null if full-day multi-slot query
	readonly meals: readonly MessMeal[];
	readonly locationDetail: MessMealLocationDetail | null;
	readonly timingExtensions: readonly MessMealTimingExtension[];
	readonly mealChanges: readonly MessMealChange[];
}

export class MessMealFactory {
	private constructor() {}

	static create(params: {
		id?: string;
		mealDate: string;
		mealSlot: MealSlot;
		vendor: Vendor;
		items: readonly string[];
		sourceMessageId?: string | null;
		ingestedAt?: Date;
	}): MessMeal {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(params.mealDate)) {
			throw new Error(`Invalid mealDate format: ${params.mealDate}. Expected YYYY-MM-DD.`);
		}
		return {
			id: params.id ?? crypto.randomUUID(),
			mealDate: params.mealDate,
			mealSlot: params.mealSlot,
			vendor: params.vendor,
			items: Object.freeze([...params.items]),
			sourceMessageId: params.sourceMessageId ?? null,
			ingestedAt: params.ingestedAt ?? new Date(),
		};
	}
}
```

### 5.2 Outbound Port Contract

```typescript
// src/core/ports/MessRepositoryPort.ts

export interface GetMealQuery {
	readonly mealDate: string; // 'YYYY-MM-DD'
	readonly mealSlot?: MealSlot; // Optional: if omitted, fetches all slots for that date/vendor (Full-Day)
	readonly vendor?: Vendor;
}

export interface MessRepositoryPort {
	getResolvedMeal(query: GetMealQuery): Promise<ResolvedMealInfo>;
}
```

### 5.3 Outbound Adapter (`src/adapters/outbound/mess/postgres/PostgresMessRepository.ts`)

Executes four parallel index-backed point queries using `Promise.all`:

1. Query `mess_meals` by `meal_date`, optional `meal_slot`, and optional `vendor`.
2. Query `mess_meal_location_details` by `meal_date` (for lunch or full-day queries).
3. Query `mess_meal_timing_extensions` by `meal_date` and optional `meal_slot`.
4. Query `mess_meal_changes` by `meal_date` and optional `meal_slot`.
   Assembles and returns `ResolvedMealInfo` in <5ms.

---

## 6. Tools, User Intent & First-Class Early Termination

### 6.1 Tool Contracts in `src/core/ports/ToolRegistryPort.ts`

```typescript
export interface ToolResult {
	content: string;
	isTerminal: boolean; // Strictly required
}

export interface Tool extends ToolDefinition {
	execute(args: Record<string, unknown>): Promise<ToolResult>;
}

export interface ToolRegistryPort {
	getToolDefinitions(): ToolDefinition[];
	executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}
```

### 6.2 Tool 1: `DisplayMessCardTool` (Terminal Tool)

- **Role**: Serves 95% of standard meal and location lookups.
- **Zod Input Schema with Descriptive Specifications**:
  ```typescript
  export const displayMessCardSchema = z.object({
  	mealDate: z
  		.string()
  		.regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO YYYY-MM-DD")
  		.optional()
  		.describe(
  			"ISO calendar date in YYYY-MM-DD format. Omit this field if the user is referring to the current or upcoming meal, or when the user does not specify an explicit date.",
  		),
  	mealSlot: z
  		.enum(["breakfast", "lunch", "dinner"])
  		.optional()
  		.describe(
  			'Strictly provide ONLY if the user explicitly mentions "breakfast", "lunch", or "dinner". If the user did NOT mention a specific meal name (e.g. they asked "menu", "food", "what is there to eat?"), you MUST omit this field so the deterministic system resolves the active or upcoming meal cutoff.',
  		),
  	vendor: z
  		.enum(["cheftalk_regular", "cheftalk_jain", "tcb"])
  		.optional()
  		.describe(
  			"Optional mess caterer. Rules: " +
  				'(1) If the user specifically mentions "jain" or "cheftalk jain", pass "cheftalk_jain". ' +
  				'(2) If the user mentions "cheftalk" without specifying Jain, pass "cheftalk_regular". ' +
  				'(3) If the user mentions "tcb" or "uniworld", pass "tcb". ' +
  				'(4) If the user does not specify any caterer (e.g. "what\'s for lunch?"), OMIT this field to display all caterers.',
  		),
  });
  ```
- **The 4-Quadrant Card Resolution Logic**:
  The tool resolves the presentation mode across the `(mealSlot, vendor)` matrix:
  1. **Quadrant 1 (Slot Provided, Vendor Omitted)**: e.g. _"What's for lunch?"_ $\rightarrow$ Multi-Vendor Slot Digest (3 lines, one per vendor for that slot) + location (if lunch).
  2. **Quadrant 2 (Slot Provided, Vendor Provided)**: e.g. _"Cheftalk lunch"_ $\rightarrow$ Single-Vendor Slot Detail (vertical bullet list of all dishes for that meal).
  3. **Quadrant 3 (Slot Omitted, Vendor Omitted)**: e.g. _"menu"_, _"food"_ $\rightarrow$ Next-Upcoming-Meal Rollover infers active slot $\rightarrow$ Renders Quadrant 1 (Multi-Vendor Slot Digest).
  4. **Quadrant 4 (Slot Omitted, Vendor Provided)**: e.g. _"TCB menu"_, _"Cheftalk menu today"_ $\rightarrow$ Single-Vendor Full-Day Digest (queries all 3 slots for that vendor on that date and renders 3 lines: Breakfast, Lunch, Dinner).
- **Next-Upcoming-Meal Rollover Logic (`resolveMealSlotAndDate`)**:
  When `mealSlot` is omitted AND `vendor` is omitted, the tool resolves the active slot and date deterministically against campus mess closing hours:
  - **Standard Mess Hours:**
    - Breakfast: 07:30 AM – 09:30 AM (Cutoff: `09:30` IST / 570 mins)
    - Lunch: 12:30 PM – 02:30 PM (Cutoff: `14:30` IST / 870 mins)
    - Dinner: 07:30 PM – 09:30 PM (Cutoff: `21:30` IST / 1290 mins)
  - **Deterministic Cutoff Resolution Table:**
    | Inbound Message Time (IST) | Meal Status                           | Resolved Slot               | Resolved Date                   |
    | :------------------------- | :------------------------------------ | :-------------------------- | :------------------------------ |
    | `00:00 – 09:30 AM`         | Before breakfast closes               | `'breakfast'`               | Today (`YYYY-MM-DD`)            |
    | `09:31 AM – 02:30 PM`      | Breakfast closed; before lunch closes | `'lunch'`                   | Today (`YYYY-MM-DD`)            |
    | `02:31 PM – 09:30 PM`      | Lunch closed; before dinner closes    | `'dinner'`                  | Today (`YYYY-MM-DD`)            |
    | `09:31 PM – 11:59 PM`      | Dinner closed for the day             | `'breakfast'` _(Rollover!)_ | Tomorrow (`YYYY-MM-DD` + 1 day) |
  - If `mealSlot` is explicitly provided by the user/LLM (e.g. _"what's for dinner?"_ at 10:00 AM), the explicit slot is always honored without applying cutoffs.
- **Past Meal Status Detection (`isMealEnded`)**:
  If a student explicitly requests a meal that has already ended (e.g. _"lunch menu"_ at 8:30 PM, or a past calendar date), the query is honored, but the header appends an `(Ended)` status tag:
  ```typescript
  function isMealEnded(mealDate: string, mealSlot: MealSlot, messageTimestamp: Date): boolean {
  	const istDate = getISTDateString(messageTimestamp);
  	if (mealDate < istDate) return true;
  	if (mealDate > istDate) return false;

  	const currentMinutes = getISTMinutes(messageTimestamp);
  	switch (mealSlot) {
  		case "breakfast":
  			return currentMinutes > 570; // Past 09:30 AM
  		case "lunch":
  			return currentMinutes > 870; // Past 02:30 PM
  		case "dinner":
  			return currentMinutes > 1290; // Past 09:30 PM
  	}
  }
  ```
- **Behavior**:
  - Fetches `ResolvedMealInfo` from `MessRepositoryPort` for the resolved `(date, slot, vendor)`.
  - **If meals exist**: Formats the respective 4-Quadrant card and returns `{ content: cardText, isTerminal: true }`.
  - **If meals are missing (`meals.length === 0`)**: Returns `{ content: "No menu scheduled...", isTerminal: false }`. Suppresses short-circuit, allowing DeepSeek to craft a natural conversational response in Turn 2.

### 6.3 Tool 2: `QueryMessDetailsTool` (Conversational Tool)

- **Role**: Serves 5% of analytical or specific dietary questions (_"does lunch have paneer?"_).
- **Behavior**:
  - Fetches `ResolvedMealInfo` from `MessRepositoryPort`.
  - Returns `{ content: JSON.stringify(data), isTerminal: false }`.
  - Proceed to Turn 2 LLM synthesis.

### 6.4 The All-or-Nothing Early Termination Rule in `AgentLoop.ts`

Inside `AgentLoop.run()`:

```typescript
const toolResults = await this.executeToolsConcurrently(
	userMessage.userId,
	response.toolCalls,
	log,
);
sessionMessages.push(...toolResults.map((r) => r.message));

// Short-circuit invariant
const allToolsAreTerminal = toolResults.length > 0 && toolResults.every((r) => r.isTerminal);

if (allToolsAreTerminal) {
	const finalContent = toolResults.map((r) => r.message.content).join("\n\n---\n\n");
	const assistantMessage = MessageFactory.createAssistantText({
		userId: userMessage.userId,
		content: finalContent,
	});
	sessionMessages.push(assistantMessage);

	return { finalText: finalContent, reasoning, sessionMessages };
}

iteration++;
```

---

## 7. Presentation Specification: Adaptive Multi-Vendor & Single-Vendor Cards

The TypeScript card renderer strictly adheres to WhatsApp mobile formatting:

- Single asterisks `*bold*` (never `**bold**`).
- Bullets with `•`.
- Zero markdown headers (`###`).
- Top-banner for active dish updates (`📢 *Active Updates:* ...`).
- Location line rendered strictly when `mealSlot === 'lunch'` (or in full-day vendor views) AND `locationDetail !== null`.

### 7.1 Text Sanitization Invariant (`sanitizeWhatsAppText`)

To prevent unclosed asterisk/underscore delimiters in dish names or announcement messages from cascading across mobile cards, all dynamic fields are sanitized prior to template assembly:

```typescript
export function sanitizeWhatsAppText(input: string): string {
	return input
		.replace(/_/g, " ") // Convert internal underscores to spaces
		.replace(/[*~`]/g, "") // Strip rogue markdown delimiters
		.replace(/\s+/g, " ") // Collapse multiple whitespace
		.trim();
}
```

### 7.2 Modular Renderer Architecture (Clean Function Decomposition)

To ensure maximum readability, maintainability, and testability, the card renderer decomposes each layout variant into dedicated, single-responsibility functions rather than a monolithic `renderMessCard()` function:

```typescript
// src/tools/mess/MessCardRenderer.ts (or DisplayMessCardTool.ts helper module)

/** Quadrant 1 & 3: Multi-Vendor Slot Digest (e.g. "lunch" across 3 vendors) */
export function renderMultiVendorSlotDigest(resolved: ResolvedMealInfo, isEnded: boolean): string;

/** Quadrant 2: Single-Vendor Slot Detail (vertical bullet list of dishes) */
export function renderSingleVendorSlotDetail(resolved: ResolvedMealInfo, isEnded: boolean): string;

/** Quadrant 4: Single-Vendor Full-Day Digest (Breakfast, Lunch, Dinner for 1 vendor) */
export function renderSingleVendorFullDayDigest(resolved: ResolvedMealInfo): string;

/** Shared modular section formatters */
export function formatCardHeader(title: string, dateStr: string, isEnded: boolean): string;
export function renderActiveUpdatesBanner(changes: readonly MessMealChange[]): string | null;
export function renderTimingExtensionsSection(
	extensions: readonly MessMealTimingExtension[],
): string | null;
export function renderLocationSection(detail: MessMealLocationDetail | null): string | null;
```

### 7.3 Dynamic Layout Rules

- **Rule 1 (Multi-Vendor Slot Digest: Quadrant 1 & 3)**: When 2 or 3 vendors are present for a single slot, delegate to `renderMultiVendorSlotDigest(...)`. Renders compact horizontal items per vendor.
- **Rule 2 (Single-Vendor Slot Detail: Quadrant 2)**: When only a single vendor and slot are being displayed (e.g. _"tcb lunch"_), delegate to `renderSingleVendorSlotDetail(...)`. Renders classic vertical bullets.
- **Rule 3 (Single-Vendor Full-Day Digest: Quadrant 4)**: When a specific vendor is requested without a slot (e.g. _"tcb menu"_, _"cheftalk menu today"_), delegate to `renderSingleVendorFullDayDigest(...)`. Renders 3 lines: Breakfast, Lunch, Dinner.
- **Rule 4 (Strict Zero-Trust Location Omission)**:
  - If `locationDetail === null`: `renderLocationSection` returns `null` (completely omitted). Never guess, never assume, and never display a default venue like "Hostel (default)".
  - If `locationDetail !== null` and `hostelBatches.length === 0`: `📍 *Location:* College (All batches)`.
  - If `locationDetail !== null` and `collegeBatches.length === 0`: `📍 *Location:* Hostel (All batches)`.
  - If `locationDetail !== null` and split: Multi-bullet breakdown (`• *Hostel:* ...\n• *College:* ...`).
- **Rule 5 (Past Meal `(Ended)` Tag)**: When an explicitly requested meal has passed its closing cutoff (e.g. lunch queried at 8:30 PM, or any past calendar date), `isEnded === true` appends `(Ended)` to the card header.

### 7.4 Reference Layouts

#### Quadrant 1: Multi-Vendor Compact Lunch (Generic _"What's for lunch?"_)

```text
🍽️ *Lunch Menu* (Wed, 7 Oct)

🍛 *Cheftalk Regular:* Rajma Masala, Jeera Rice, Roti, Boondi Raita
🥗 *Cheftalk Jain:* Yellow Dal, Jeera Rice, Roti, Cucumber Raita
☕ *TCB (Uniworld):* Chole Bhature, Veg Pulao, Gulab Jamun

📍 *Location:* College (All batches)
```

#### Quadrant 2: Single-Vendor Vertical Bullet Lunch (Targeted _"Cheftalk lunch"_)

```text
🍽️ *Lunch — Cheftalk Regular* (Wed, 7 Oct)

• Rajma Masala
• Jeera Rice
• Butter Roti
• Boondi Raita
• Green Salad
• Mixed Pickle

📍 *Location:* College (All batches)
```

#### Quadrant 4: Single-Vendor Full-Day Digest (Targeted _"TCB menu"_)

```text
🍽️ *TCB (Uniworld) — Full Day Menu* (Wed, 7 Oct)

🌅 *Breakfast:* Poha, Jalebi, Mint Chutney, Tea / Coffee
🍛 *Lunch:* Chole Bhature, Veg Pulao, Curd, Gulab Jamun
🌙 *Dinner:* Veg Biryani, Mirchi Salan, Raita, Ice Cream

📍 *Lunch Location:* College (All batches)
```

#### Past Meal with `(Ended)` Tag (_"Lunch menu"_ queried at 8:30 PM)

```text
🍽️ *Lunch Menu (Ended)* (Wed, 7 Oct)

🍛 *Cheftalk Regular:* Rajma Masala, Jeera Rice, Roti, Boondi Raita
🥗 *Cheftalk Jain:* Yellow Dal, Jeera Rice, Roti, Cucumber Raita
☕ *TCB (Uniworld):* Chole Bhature, Veg Pulao, Gulab Jamun

📍 *Location:* College (All batches)
```

#### Single-Vendor Past Meal with `(Ended)` Tag (_"Cheftalk lunch"_ queried at 8:30 PM)

```text
🍽️ *Lunch — Cheftalk Regular (Ended)* (Wed, 7 Oct)

• Rajma Masala
• Jeera Rice
• Butter Roti
• Boondi Raita
• Green Salad

📍 *Location:* College (All batches)
```

#### Lunch with Active Dish Update & Split Seating

```text
🍽️ *Lunch Menu* (Wed, 7 Oct)
📢 *Active Updates:* Mix Veg replacing Paneer at Cheftalk today

🍛 *Cheftalk Regular:* Mix Veg, Dal Tadka, Jeera Rice, Roti
🥗 *Cheftalk Jain:* Yellow Dal, Jeera Rice, Roti, Cucumber Raita
☕ *TCB (Uniworld):* Chole Bhature, Veg Pulao, Gulab Jamun

📍 *Location:*
• *Hostel:* Batches 2027, 2028, 2029 A
• *College:* All other batches
```

#### Dinner with Timing Extension

```text
🍽️ *Dinner Menu* (Wed, 7 Oct)
⏰ *Timings:* Extended till 11:00 PM (Cultural Fest)

🍛 *Cheftalk Regular:* Dal Makhani, Paneer Pulao, Roti
🥗 *Cheftalk Jain:* Shahi Paneer, Pulao, Roti
☕ *TCB (Uniworld):* Veg Biryani, Mirchi Salan, Ice Cream
```

---

## 8. Temporal Grounding & Invariant Safety

1. **Message Reception Anchoring**:
   - In `AgentLoop.ts`, temporal context injected into prompt is derived from `userMessage.timestamp` formatted in `Asia/Kolkata`:
     ```typescript
     const messageTimeIST = userMessage.timestamp.toLocaleString("en-IN", {
     	timeZone: "Asia/Kolkata",
     	dateStyle: "full",
     	timeStyle: "medium",
     });
     ```
   - Eliminates midnight queueing bugs and guarantees 100% test reproducibility.
2. **Turn Invariant Safety**:
   - `AgentLoop`'s early termination path explicitly appends an `AssistantTextMessage` created via `MessageFactory.createAssistantText`.
   - Strictly satisfies PostgreSQL constraint `chk_dialogue_turns_messages` on `dialogue_turns`.

---

## 9. Verification & Testing Strategy

1. **Database Schema & Migration**:
   - Drizzle migrations generated via `npm run db:generate` and tested with `npm run db:migrate`.
2. **Unit Tests**:
   - `tests/core/use-cases/AgentLoop.test.ts`:
     - Single terminal tool call short-circuits in 1 iteration without second LLM invocation.
     - Multi-terminal tool calls join cleanly with `\n\n---\n\n`.
     - Mixed terminal and non-terminal tool calls suppress short-circuit and proceed to Turn 2.
     - Malformed tool calls suppress short-circuit and feed errors to model.
   - `tests/tools/DisplayMessCardTool.test.ts`:
     - Correct rendering of all 5 visual scenarios.
     - Returns `isTerminal: false` when zero meals are found.
     - Omission of location line on breakfast and dinner.
   - `tests/adapters/outbound/mess/postgres/PostgresMessRepository.test.ts`:
     - Parallel query aggregation and mapping to `ResolvedMealInfo`.
3. **Ingestion Verification**:
   - Verification of PDF embedded text extraction + rasterization on `WEEKLY MENU OCT 4-10-3.pdf`.
   - Verification of atomic transaction rollbacks on simulated ingestion failures.
