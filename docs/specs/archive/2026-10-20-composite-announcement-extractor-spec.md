# Specification: Composite Food Announcement Extractor & One-Way Meal Swaps

- **Document ID**: `2026-10-20-composite-announcement-extractor-spec`
- **Date**: 2026-10-20
- **Status**: Draft (Pending Human Review Gate)
- **Target Worktree**: `/home/pujan/iny/.worktrees/feat-mess-meals-subsystem`
- **Target Branch**: `feat-mess-meals-subsystem`

---

## 1. Executive Summary & Problem Context

In real-world campus operations, WhatsApp food announcements frequently bundle multiple distinct operational changes into a single message. For instance, a coordinator might announce:

> _"Lunch is extended till 3:00 PM today. 2028 and 2029 will have lunch in Hostel Mess, others in College Mess. Also, paneer butter masala is replaced with Kadhai Paneer at Cheftalk Regular."_

The current V1 implementation forces an admin to select a single rigid extraction intent (`[2] Location Seating`, `[3] Timing Extension`, or `[4] Meal Replacement`), making it impossible to capture combined events without manually duplicating or re-triaging the message. Furthermore, coordinators often issue cross-day/cross-slot meal substitutions by reference alone (e.g., _"Today's dinner will serve tomorrow's lunch menu"_).

This specification defines a **Composite Announcement Extractor** that:

1. In a single pass, prompts DeepSeek to detect and extract all applicable events: location seating, timing extensions, dish-level changes, and one-way meal swaps.
2. Formats and validates the extraction via a composite Zod schema.
3. Automatically resolves "reference-only" meal swaps against the database, enforcing a strict pre-commit validation gate (blocking commit if the source menu is missing).
4. Commits all operational changes atomically in PostgreSQL inside a single transaction while tagging `source_message_id`.
5. Guarantees 100% reversible surgical rollback (`[u] Undo`) that restores original meal dishes and deletes associated operational rows.

---

## 2. Domain Entities & Schemas

### 2.1 One-Way Meal Swap Schema (`ExtractedMealSwapSchema`)

A meal swap represents a substitution where the target meal adopts the menu items of a referenced source meal.

```typescript
export const ExtractedMealSwapSchema = z.object({
	targetMealDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	targetMealSlot: z.enum(["breakfast", "lunch", "dinner"]),
	sourceMealDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	sourceMealSlot: z.enum(["breakfast", "lunch", "dinner"]),
	targetVendor: z.enum(["cheftalk_regular", "cheftalk_jain", "tcb"]).nullable().optional(),
});
export type ExtractedMealSwap = z.infer<typeof ExtractedMealSwapSchema>;
```

### 2.2 Composite Extraction Schema (`ExtractedCompositeAnnouncementSchema`)

Combines location seating, timing extensions, dish changes, and meal swaps into a single validated data structure:

```typescript
export const ExtractedCompositeAnnouncementSchema = z.object({
	mealDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	location: ExtractedLocationDetailSchema.optional().nullable(),
	timingExtensions: z.array(ExtractedTimingExtensionSchema).default([]),
	mealChanges: z.array(ExtractedMealChangeSchema).default([]),
	mealSwaps: z.array(ExtractedMealSwapSchema).default([]),
});
export type ExtractedCompositeAnnouncement = z.infer<typeof ExtractedCompositeAnnouncementSchema>;
```

### 2.3 Campus Batch Invariants

In `location`:

- `hostelBatches` and `collegeBatches` strictly contain valid campus batch identifiers:
  `'2027'`, `'2028'`, `'2029'`, `'2030'`, `'2030 E'`, `'ALL_BATCHES'`, `'ALL_OTHER_BATCHES'`.
- Generic academic markers (`UG1`, `PhD`) are rejected at the prompt and validation layer.

---

## 3. DeepSeek Multimodal & Text Extractor Adapter

### 3.1 Interface Contract

`DeepseekTextExtractor` exposes:

```typescript
async extractAnnouncementEvents(
  textBody: string,
  receivedAt: Date
): Promise<ExtractedCompositeAnnouncement>
```

### 3.2 Prompt Engineering & Temporal Grounding

1. **IST Grounding**: The system prompt injects the exact message arrival timestamp in `Asia/Kolkata` (e.g. `Current Reference Timestamp: Tuesday, 2026-10-20 14:15:00 IST`).
2. **Relative Reference Resolution**:
   - `"today"` resolves to the calendar date of `receivedAt`.
   - `"tomorrow"` resolves to `receivedAt + 1 day`.
   - Named days (e.g. `"Wednesday"`, `"Friday"`) resolve to the next occurrence of that weekday relative to `receivedAt`.
3. **Multi-Event Instruction**: Instructs the LLM to populate all applicable sections. Any category not mentioned in the message MUST default to `null` (for `location`) or `[]` (for arrays).
4. **Vendor Mapping**:
   - Cheftalk Regular -> `cheftalk_regular`
   - Cheftalk Jain -> `cheftalk_jain`
   - TCB / Uniworld -> `tcb`
   - Unspecified / All Vendors -> `null`

### 3.3 Error Classification & Resilience

- Traps HTTP 429 and rate limits as `LLMRateLimitError`.
- Traps network timeouts and 5xx errors as `LLMTransientError`.
- Markdown stripping: Cleans markdown JSON fences (`json ... `) before calling `JSON.parse`.

---

## 4. Database Persistence & Transactional Invariants

### 4.1 Atomic Commit (`PostgresMessStagingRepository.atomicCommitComposite`)

All database operations execute inside a single PostgreSQL transaction (`db.transaction`):

1. **Location Seating**:
   If `location` is non-null:
   - Upsert into `mess_meal_location_details` on conflict `(meal_date, meal_slot)`.
   - Tags `source_message_id = messageId`.
2. **Timing Extensions**:
   If `timingExtensions.length > 0`:
   - Inserts rows into `mess_meal_timing_extensions`.
   - Tags `source_message_id = messageId`.
3. **Dish Changes**:
   If `mealChanges.length > 0`:
   - Inserts rows into `mess_meal_changes`.
   - Tags `source_message_id = messageId`.
4. **Meal Swaps (Data Mutation + Reversible Backup)**:
   For each swap in `resolvedSwaps`:
   - Queries `mess_meals` for `(sourceMealDate, sourceMealSlot, vendor)` to retrieve source items.
   - Queries `mess_meals` for `(targetMealDate, targetMealSlot, vendor)` to retrieve existing target items (`previousItems`).
   - Updates `mess_meals` setting `items = sourceItems` where `meal_date = targetMealDate` and `meal_slot = targetMealSlot`.
   - Inserts a record into `mess_meal_changes`:
     - `mealDate`: `targetMealDate`
     - `mealSlot`: `targetMealSlot`
     - `targetVendor`: `vendor`
     - `changeType`: `'replacement'`
     - `affectedItem`: `${formatDateIST(sourceMealDate)} ${sourceMealSlot} Menu (${sourceItems.join(', ')})`
     - `originalItem`: `JSON.stringify(previousItems)` (stores raw JSON of previous items for symmetric restoration)
     - `sourceMessageId`: `messageId`
5. **Staging Message Status**:
   - Updates `whatsapp_group_food_announcements_messages` setting `status = 'processed'` and `processed_at = new Date()`.

### 4.2 Surgical Rollback (`atomicUndo`)

When an admin requests `[u] Undo` on a processed message ID:
Inside `db.transaction`:

1. **Restore Swapped Meals**:
   - Queries `mess_meal_changes` where `source_message_id = messageId` and `original_item` starts with `[` (valid JSON array of strings).
   - For each swap change, restores `mess_meals.items = JSON.parse(change.originalItem)` for that `(mealDate, mealSlot, targetVendor)`.
2. **Delete Operational Rows**:
   - Deletes from `mess_meal_location_details WHERE source_message_id = messageId`.
   - Deletes from `mess_meal_timing_extensions WHERE source_message_id = messageId`.
   - Deletes from `mess_meal_changes WHERE source_message_id = messageId`.
3. **Reset Staged Message**:
   - Updates `whatsapp_group_food_announcements_messages` setting `status = 'pending'`, `processed_at = null`.

---

## 5. Triage CLI Workflow & Remediation

### 5.1 Simplified Action Menu

- **Text Announcements**:
  ```text
  Select action:
    [1] Process Announcement (Auto-Extract Location, Timing, Changes & Swaps)
    [2] Ignore Message
    [c] Cancel / Skip
  ```
- **Media Announcements (Image / PDF)**:
  ```text
  Select action:
    [1] Extract Weekly Menu
    [2] Process Announcement (Auto-Extract Location, Timing, Changes & Swaps)
    [3] Open in Viewer
    [4] Ignore Message
    [c] Cancel / Skip
  ```

### 5.2 Unified Composite Preview Card

The CLI displays an ANSI preview card detailing all detected events:

```text
┌─ Extracted Announcement Events (Date: 2026-10-20) ──────────────────────────┐
│  📍 Location: 2028, 2029 in Hostel | ALL_OTHER_BATCHES in College (Lunch)     │
│  ⏰ Timing: Lunch extended till 15:00                                        │
│  🔄 Changes: None                                                           │
│  🔁 Swaps: None                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
Actions: [y] Confirm & Commit | [e] Edit in Neovim | [c] Cancel
```

### 5.3 Meal Swap Validation Gate (Option B)

Before displaying the preview card:

1. For each item in `mealSwaps`, the controller queries the database for `(sourceMealDate, sourceMealSlot)`.
2. **If Found**: Resolves dishes and previews the exact menu being copied:
   ```text
   │  🔁 Meal Swap: 2026-10-20 Dinner <- 2026-10-21 Lunch                         │
   │     Resolved Items: [Rajma, Jeera Rice, Boondi Raita, Roti, Gulab Jamun]   │
   ```
3. **If Missing (Hard Gate)**:
   The `[y] Confirm` action is disabled. The card renders:
   ```text
   ❌ Cannot Commit Swap: Source menu for 2026-10-21 Lunch was not found in the database.
   Please ingest that date's weekly menu before committing this announcement.
   Actions: [e] Edit in Neovim | [c] Cancel
   ```

### 5.4 Neovim Editing (`[e] Edit in Neovim`)

- Spawns the editor with the formatted JSON of `ExtractedCompositeAnnouncement`.
- On exit, validates against `ExtractedCompositeAnnouncementSchema`.
- Re-renders the preview card with the edited data.

---

## 6. Testing & Quality Strategy

1. **Schema Validation Tests (`ExtractionSchemas.test.ts`)**:
   - Verifies `ExtractedCompositeAnnouncementSchema` handles empty arrays, missing optional location, and multi-event payloads.
   - Verifies `ExtractedMealSwapSchema` rejects invalid dates, invalid slots, and invalid vendors.
2. **Text Extractor Tests (`DeepseekExtractors.test.ts`)**:
   - Tests `extractAnnouncementEvents` with mock DeepSeek completions for:
     - Single event (only location).
     - Combo event (location + timing extension).
     - Meal swap event.
     - Combo event (dish change + meal swap + timing extension).
   - Verifies retry on `LLMRateLimitError` and `LLMTransientError`.
3. **Staging Repository Tests (`PostgresMessStagingRepository.test.ts`)**:
   - Verifies `atomicCommit` inserts into location, timing, and changes simultaneously.
   - Verifies `atomicCommit` with a swap replaces `mess_meals.items` and creates a change notice with backed-up items.
   - Verifies `atomicUndo` restores original `mess_meals.items` and deletes all operational rows.
4. **CLI Controller Tests (`TriageCliController.test.ts`)**:
   - Verifies streamlined action menu.
   - Verifies hard-gate blocking when swap source menu is missing.
   - Verifies successful swap commit when source menu exists.
   - Verifies Neovim editing round-trip.
5. **Full Suite Regression Check**:
   - `npm test` and `npm run typecheck` across all 47 test suites to guarantee 0 regressions.
