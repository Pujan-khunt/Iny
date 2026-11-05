# Iny Inbound Idempotency & User Mess Preference Specification

## 1. Overview & Business Objectives

During production testing of direct messaging in Iny, two distinct operational issues were identified:

1. **Duplicate Response Execution (Critical)**:
   When a user sent `"Cheftalk menu"`, WhatsApp retransmitted the stanza with the exact same message ID (`AC84669FB16ACA320B90E204C1DB0EA8`) 9.6 seconds later. Because the application lacked inbound message deduplication, the second stanza was processed as a brand new turn. The first completed turn was fetched into LLM context, leading DeepSeek to reason that the user was repeating the query, resulting in a duplicate tool invocation and double WhatsApp reply.

2. **Flawed Single-Vendor Menu Card Routing (UX / Screen Real Estate)**:
   - **Stale Ended Meals**: Querying `"Cheftalk menu"` at 16:00 IST triggered the artificial "Quadrant 4" branch in `DisplayMessCardTool`, rendering a full-day digest with past, ended meals (Breakfast and Lunch) alongside Dinner. On mobile screens (360–390px viewport), this spanned 10–14 vertical lines, pushing the relevant upcoming meal off the screen.
   - **Unclear Vendor Ambiguity**: The system prompt provided three peer vendor enums (`cheftalk_regular`, `cheftalk_jain`, `tcb`) without default alias semantics. The LLM hesitated in Chain-of-Thought whether to clarify or guess between regular and jain.
   - **Generic Menu Clutter**: A generic `"menu"` query renders a multi-vendor digest (Cheftalk Regular + TCB), which takes excessive vertical space on mobile devices when ~90% of students eat exclusively at Cheftalk Regular.

### Goal

1. Guarantee **inbound message idempotency** at the router gateway via in-flight locking and sliding TTL caching.
2. Eliminate the full-day hijack in `DisplayMessCardTool` so any vendor-specific query without an explicit meal slot automatically displays the **upcoming active meal**.
3. Establish **tool-level deterministic defaults** where generic `"menu"` resolves to the student's persistent default mess (`cheftalk_regular` by default), with zero LLM hallucination risk.
4. Provide a `SetDefaultMessTool` allowing students to update their default mess explicitly, accompanied by a deterministic 1-line contextual tip whenever a student queries a non-default vendor.

---

## 2. Invariants & Architectural Principles

1. **Gateway Idempotency Invariant**: Any incoming message stanza whose `messageId` is currently in-flight or was processed within the sliding TTL window (10 minutes) must be discarded at the router level before executing downstream adapters, database queries, or LLM calls.
2. **Tool Determinism Principle**: The LLM remains a stateless semantic extractor. It must never be burdened with calculating cutoffs, tracking frequency, or managing user defaults. The LLM passes `{}` for generic menu requests, and the tool deterministically resolves the user's default mess.
3. **Canonical Vendor Default**: On campus, `"cheftalk"` or `"chef talk"` (without `"jain"`) strictly denotes `cheftalk_regular`. Only queries explicitly mentioning `"jain"` map to `cheftalk_jain`.
4. **Contextual Non-Intrusive Guidance**: Guidance tips for setting defaults must only appear when a student requests a non-default vendor (e.g. asking for TCB when their default is Cheftalk). Generic `"menu"` cards must remain completely uncluttered.
5. **Constitution & Hexagonal Purity**: All core ports and entities remain pure TypeScript with zero external runtime dependencies. All production files must strictly observe the 150-line limit defined in `.agents/constitution.md`.

---

## 3. Functional Requirements & Domain Logic

### 3.1 Global Inbound Idempotency & In-Flight Concurrency Guard

- **Location**: `src/adapters/inbound/whatsapp/router/WhatsAppMessageRouter.ts`
- **Mechanics**:
  1. **In-Flight Lock**: Maintain `inFlightMessageIds = new Set<string>()`.
     - When `dispatchMessage(raw, upsertType)` runs: if `raw.key.id` is present in `inFlightMessageIds`, log `debug("Duplicate incoming message dropped (in-flight)", { messageId })` and return immediately.
     - Add `raw.key.id` to `inFlightMessageIds` before handler execution, and remove it in a `finally` block.
  2. **Sliding TTL Cache**: Maintain `processedMessageIds = new Map<string, number>()` storing message ID to completion epoch timestamp.
     - **Window**: 10 minutes (`10 * 60 * 1000` ms).
     - If `raw.key.id` exists in `processedMessageIds` and has not expired, log `debug("Duplicate incoming message dropped (already processed)", { messageId })` and return immediately.
     - Upon successful handler completion, record `raw.key.id` with `Date.now()`.
  3. **Bounded Eviction**: When `processedMessageIds.size > 2000`, prune expired entries to maintain bounded memory footprint.

---

### 3.2 DisplayMessCardTool Upcoming Slot Normalization

- **Location**: `src/tools/DisplayMessCardTool.ts`
- **Mechanics**:
  1. Remove the artificial branch:
     ```ts
     if (!args.mealSlot && args.vendor) {
     	return this.handleFullDayDigest(args.mealDate, args.vendor, now);
     }
     ```
  2. Route all queries with omitted `mealSlot` through `handleSlotQuery(args, now)`.
  3. `handleSlotQuery` evaluates `resolveSlotTarget(args, now)`:
     - When `mealSlot` is omitted, it invokes `determineNextUpcomingSlot(now)`.
     - If `args.vendor` is provided, it calls `renderSingleVendorSlotDetail(resolved, args.vendor, ended)`.
     - If `args.vendor` is omitted, it deterministically resolves the vendor from the caller's `default_vendor` column in the `users` database table (which defaults to `'cheftalk_regular'`).
  4. **Outcome**: `"Cheftalk menu"` at 16:00 IST displays **only Cheftalk Regular Dinner**, matching student expectations and mobile screen height. Generic `"menu"` renders only the caller's database `default_vendor` meal.

---

### 3.3 Persistent User Default Mess & Access Control Integration

- **Database Schema (`users` Table)**:
  - Add column: `default_vendor vendor NOT NULL DEFAULT 'cheftalk_regular'`.
  - Schema definition in `src/adapters/outbound/access-control/postgres/schema.ts`.
  - Migration script generated via Drizzle.
- **Core Port & Entity (`AccessControlPort`)**:
  - Update `AllowedUserRecord`:
    ```ts
    export interface AllowedUserRecord {
    	phoneNumber: string;
    	pnJid: string;
    	lidJid: string | null;
    	name: string | null;
    	role: "admin" | "user";
    	status: "active" | "blocked";
    	defaultVendor: Vendor;
    }
    ```
  - Add mutation method to `AccessControlPort`:
    ```ts
    setDefaultVendor(userId: string, vendor: Vendor): Promise<void>;
    ```
- **Postgres Adapter (`PostgresAccessControlAdapter`)**:
  - Select and cache `defaultVendor` during `authenticate()`.
  - Implement `setDefaultVendor` with database update and in-memory cache synchronization.

---

### 3.4 SetDefaultMessTool

- **Location**: `src/tools/SetDefaultMessTool.ts`
- **Input Schema**:
  ```ts
  const setDefaultMessSchema = z.object({
  	vendor: z
  		.enum(["cheftalk_regular", "cheftalk_jain", "tcb"])
  		.describe(
  			'Target mess vendor to set as user default: "cheftalk_regular" (for "cheftalk", "chef talk", "regular"), "cheftalk_jain" (for "jain", "cheftalk jain"), or "tcb" (for "tcb", "uniworld").',
  		),
  });
  ```
- **Behavior**:
  - Invokes `accessControl.setDefaultVendor(callingUserId, args.vendor)`.
  - Returns terminal response:
    ```text
    ✅ Default mess updated to TCB (Uniworld). Next time you ask for "menu", you'll receive the TCB menu.
    ```
  - `isTerminal: true`.

---

### 3.5 Contextual Non-Default Hint in Presentation Layer

- **Location**: `src/adapters/outbound/mess/formatting/MessCardRenderer.ts`
- **Trigger Condition**:
  - When rendering a single-vendor slot card (`renderSingleVendorSlotDetail`), check if the requested `vendor` differs from the user's `defaultVendor`.
  - If `requestedVendor !== userDefaultVendor`:
    Append a single clean footer line using human-friendly vendor names:
    - For `tcb`: `_Tip: Say "set default to TCB" to make this your default menu._`
    - For `cheftalk_regular`: `_Tip: Say "set default to Cheftalk" to make this your default menu._`
    - For `cheftalk_jain`: `_Tip: Say "set default to Jain" to make this your default menu._`
  - When `requestedVendor === userDefaultVendor`, omit the footer line completely to keep the card minimal.

---

### 3.6 System Prompt & Uniform Alias Directives

- **Location**: `src/core/prompts/SystemPrompt.ts`
- **Directives**:
  1. **Uniform Vendor Alias Rules** (applies across ALL menu lookups AND default-setting requests):
     - `"cheftalk"`, `"chef talk"`, `"cheftalk regular"`, or `"regular"` (without `"jain"`) **always** maps to `cheftalk_regular`.
     - `"jain"` or `"cheftalk jain"` **always** maps to `cheftalk_jain`.
     - `"tcb"`, `"the craving brew"`, or `"uniworld"` **always** maps to `tcb`.
     - Natural language queries like _"set default to chef talk"_, _"make uniworld my mess"_, or _"I eat at TCB"_ must be mapped to their canonical enum value smoothly without rejection or hesitation.
  2. **General Menu Request**:
     - When the user asks for a general menu without naming a vendor, pass empty `{}` to `display_mess_card`. Do not guess or supply a vendor; trust tool determinism.
  3. **Preference Setting Directives**:
     - When the user expresses intent to change, switch, or set their default mess (e.g. _"I eat at TCB"_, _"make TCB my default"_, _"switch to chef talk"_, _"set default to regular"_), call `set_default_mess` with the resolved vendor enum.

---

## 4. Edge Cases & Defensive Invariants

| Edge Case                                                                  | Expected System Behavior                                                                                         |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Retransmitted WhatsApp stanza arrives 200ms after initial (in-flight)      | Caught by `inFlightMessageIds` set; immediately dropped.                                                         |
| Retransmitted WhatsApp stanza arrives 9 seconds after initial (completed)  | Caught by `processedMessageIds` TTL cache; immediately dropped.                                                  |
| User texts `"menu"` after switching default to `tcb`                       | Tool resolves `tcb`; upcoming TCB slot card rendered without tip.                                                |
| User texts `"cheftalk menu"` after switching default to `tcb`              | Tool renders Cheftalk card + appends tip: `_Tip: Say "set default to Cheftalk" to make this your default menu._` |
| User explicitly specifies past meal (e.g. `"cheftalk breakfast"` at 16:00) | Tool respects explicit slot and renders Breakfast card with `*(Ended)*` tag.                                     |
| User texts `"jain food"`                                                   | Prompt maps to `cheftalk_jain`; tool renders Jain upcoming slot card.                                            |

---

## 5. Verification & Acceptance Criteria

1. **Router Deduplication Unit Tests**:
   - Verify concurrent identical stanzas are dropped by in-flight lock.
   - Verify sequential duplicate stanzas within 10 minutes are dropped by TTL cache.
   - Verify distinct `messageId` stanzas proceed independently.
2. **DisplayMessCardTool Unit Tests**:
   - Querying with `vendor: "cheftalk_regular"` and omitted `mealSlot` returns upcoming slot detail (Dinner at 16:00), not full-day digest.
   - Querying with `{}` uses user's `defaultVendor`.
3. **AccessControl & SetDefaultMessTool Tests**:
   - Verify `setDefaultVendor` persists and updates in-memory cache.
   - Verify `SetDefaultMessTool` executes and returns terminal confirmation.
4. **Full Regression Test Pass**:
   - `npm test` passes 100% of test suites with zero regressions.
