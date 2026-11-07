# Operational Food Announcement Ingestion Specification

## 1. Problem Statement & Motivation

The automated food ingestion pipeline successfully ingests 7-day weekly menu PDFs (`AC15B79596C962A8BA9FF87679772AD5` committed 21 meals cleanly to PostgreSQL). However, inbound non-menu operational text announcements (e.g., campus mess holiday announcements such as `📢 Lunch will be arranged in the hostel from *6th November 2026 to 12th November 2026*...`) consistently fail across 4 distinct chokepoints in the ingestion pipeline:

1. **Top-Level Schema Envelope Mismatch (Crash in Pass 1)**:
   - `FoodExtractionSchema` expects `{ kind: "candidate", candidate: { ... }, evidence: [ ... ] }`.
   - The LLM frequently emits `{ kind: "operational_announcement", announcement: { ... }, evidence: [ ... ] }` at the root, because the prompt states `Operational candidate: {"kind":"operational_announcement", ...}`.
   - Zod schema parsing fails with `Invalid discriminator value. Expected 'candidate' | 'unsupported' | 'uncertain'`, crashing the worker task with `invalid_model_response`.

2. **The Campus-Wide Allocation Catch-22 (Rejection in Validator / Verifier)**:
   - In campus mess operations, general announcements (e.g., _"Lunch will be arranged in the hostel"_) omit batch names because the update applies campus-wide to all students.
   - Currently, `FoodExtractionPrompt.ts` strictly forbids `ALL_BATCHES` unless the exact words "all batches" appear, forcing the model to emit empty arrays (`hostelBatches: []`, `collegeBatches: []`).
   - `OperationalAnnouncementValidator.ts` rejects any location event where `[...hostelBatches, ...collegeBatches].length === 0` with `ambiguous_content: "Incomplete or conflicting event scope."`.
   - The Pass 2 independent verifier flags `missingFields: ["announcement scope: hostel venue is explicitly stated in the source but is not represented in the candidate"]`.
   - Even if the model emits `ALL_BATCHES`, `AnnouncementEvidenceValidator.ts` requires a literal substring matching `/^all(?:\s+(?:batches|students))?$/i`, which does not exist in the source text.

3. **Date Resolution Bottlenecks (Month Names & Date Ranges)**:
   - `AnnouncementDateResolver.ts` contains a blanket check `if (monthDate.test(reference)) return [null];` that disqualifies any reference with a textual month name (e.g., `6th November 2026`), even when an explicit 4-digit year is present.
   - In `AnnouncementDateEvidence.ts`, `clauseDate()` passes the entire clause string to `AnnouncementDateResolver`. When an announcement clause specifies a multi-day date range (e.g., `*6th November 2026 to 12th November 2026*`), `AnnouncementDateResolver` detects two dates and rejects the clause as `conflicting_date: "Stated dates disagree."`.

4. **Monolithic Prompt & Misleading Observability**:
   - `DeepseekFoodAssessmentAdapter.ts` hardcodes `this.logger.info("Pass 1: Requesting menu extraction")` unconditionally for all message types.
   - A single monolithic prompt mixes PDF weekly menu table rules with text operational rules, sending menu-table instructions to text messages and operational instructions to PDF documents.

---

## 2. Requirements & Domain Logic

### 2.1 Medium-Specific Prompts & Extraction Logging

1. **Prompt Specialization**:
   - Separate extraction prompts by source medium:
     - **Text Messages (`source.messageType === "text"`)**: Use a dedicated `operationalExtractionPrompt` focusing strictly on operational events (location allocations, service timings, dish changes/substitutions/cancellations, and meal swaps), without extraneous weekly menu, table-cell, or vendor-matrix instructions.
     - **Media Messages (`source.messageType === "document" | "image"`)**: Use a dedicated `weeklyMenuExtractionPrompt` focusing on weekly menu table parsing.
2. **Accurate Diagnostic Logging**:
   - In `DeepseekFoodAssessmentAdapter.ts`, log the precise target action:
     - `"Pass 1: Requesting operational announcement extraction"` for `source.messageType === "text"`.
     - `"Pass 1: Requesting weekly menu extraction"` for media sources.

### 2.2 Defensive Top-Level Envelope Normalization

1. **Envelope Normalization Contract**:
   - In `DeepseekFoodAssessmentAdapter.ts`, prior to calling `schemas.FoodExtractionSchema.parse()`, the adapter must inspect the raw parsed JSON:
     - If the object contains root `kind: "operational_announcement"` and `announcement`: normalize into `{ kind: "candidate", candidate: { kind: "operational_announcement", announcement: raw.announcement }, evidence: raw.evidence ?? [] }`.
     - If the object contains root `kind: "weekly_menu"` and `menu`: normalize into `{ kind: "candidate", candidate: { kind: "weekly_menu", dateRange: raw.dateRange, menu: raw.menu }, evidence: raw.evidence ?? [] }`.
     - Unmodified passthrough for responses already wrapped in `kind: "candidate"`, `kind: "unsupported"`, or `kind: "uncertain"`.
2. **Schema Integrity**:
   - Normalization must not bypass downstream Zod schema validation; all fields, dates, and evidence arrays must still strictly satisfy `FoodExtractionSchema`.

### 2.3 General / Campus-Wide Venue Allocation

1. **Campus-Wide Allocation Domain Semantics**:
   - When an announcement explicitly allocates meals to a venue (e.g. _"in the hostel"_ or _"in college"_) without restricting to specific cohorts or sections (e.g. no mentions of "2028", "2029 B", "except", etc.):
     - The stated venue receives `["ALL_BATCHES"]`.
     - The unstated venue receives `[]`.
2. **Prompt Instruction**:
   - Update extraction prompt instructions: If an operational announcement states a venue (e.g. _"Lunch will be arranged in the hostel"_) without batch names, allocate `ALL_BATCHES` to that venue and `[]` to the other venue.
3. **Evidence Validation for Campus-Wide Scope**:
   - In `AnnouncementEvidenceValidator.ts`:
     - When `value === "ALL_BATCHES"`:
       - Accept literal matches for `"all"`, `"all batches"`, `"all students"`.
       - OR accept the venue clause itself (e.g. `"in the hostel"`, `"arranged in the hostel"`, `"in college"`) when the candidate allocation assigns `ALL_BATCHES` to that venue and no cohort-specific batch words are present in the clause.

### 2.4 Written Month Names with Year Support in `AnnouncementDateResolver`

1. **Explicit Month Parsing**:
   - `AnnouncementDateResolver.ts` must parse written month dates that include an explicit year:
     - Patterns: `DDth Month YYYY`, `DD Month YYYY`, `Month DDth, YYYY`, `Month DD YYYY`, and hyphenated variants (`6-Nov-2026`).
     - Supported months: English full and abbreviated month names (`January`..`December`, `Jan`..`Dec`, case-insensitive).
     - Year: 4-digit (`2026`) or 2-digit (`26` $\rightarrow 2026$).
2. **Preservation of Ambiguity Guards**:
   - Dates with month names but NO year (e.g. `1 November`, `November 3rd`, `next Sunday`) must continue to be rejected as `invalid_date`, preserving existing anti-hallucination invariants.

### 2.5 Multi-Day Date Range Support in `AnnouncementDateEvidence`

1. **Range Clause Semantics**:
   - Operational announcements frequently span date ranges (e.g., _"from 6th November 2026 to 12th November 2026"_).
   - In such announcements, the LLM expands the range into individual daily location or timing events.
2. **Clause Validation Contract**:
   - In `AnnouncementDateEvidence.ts`, `clauseDate()` must recognize date range clauses (`from <start> to <end>` or `<start> to <end>` or `<start> - <end>`):
     - Resolve the start date and end date from the clause.
     - If the clause defines a valid date range `[startDate, endDate]`:
       - Verify that `startDate <= endDate`.
       - Verify that the event's `mealDate` satisfies `startDate <= mealDate <= endDate`.
     - If the clause specifies a single date (non-range), maintain existing exact equality check (`clauseDate === mealDate`).

---

## 3. Architectural Invariants & Constitution Compliance

1. **150-Line Limit**:
   - Any new or modified file in `src/` must remain $\le 150$ lines.
   - If `AnnouncementDateResolver.ts` or `AnnouncementDateEvidence.ts` approach limit thresholds, extract cohesive sub-helpers (e.g., `WrittenMonthDateParser.ts`, `DateRangeClauseMatcher.ts`).
2. **40-Line Function Limit**:
   - All helper functions and methods must remain $\le 40$ lines.
3. **Hexagonal Purity**:
   - Pure domain services (`src/core/services/`) remain 100% pure TypeScript with zero external runtime dependencies.
4. **Zero Speculative Abstraction**:
   - Only implement support for verified announcement patterns observed in logs and specifications.

---

## 4. Verification & Testing Plan

1. **Unit Tests**:
   - `AnnouncementDateResolver.test.ts`:
     - Test written month formats: `6th November 2026`, `6 Nov 2026`, `Nov 6, 2026`, `12th November 2026`, `26-Nov-2026`.
     - Confirm yearless dates (`1 November`, `November 3rd`) still reject.
   - `AnnouncementDateEvidence.test.ts`:
     - Test multi-day range clauses (`from 6th November 2026 to 12th November 2026`) validating individual dates (Nov 6, Nov 7, ..., Nov 12).
     - Test rejection when event date is outside the clause range (e.g., Nov 13).
   - `AnnouncementEvidenceValidator.test.ts`:
     - Test campus-wide allocation (`ALL_BATCHES`) with venue clause evidence (`"in the hostel"`).
   - `DeepseekFoodAssessmentAdapter.test.ts`:
     - Test normalization of flattened root responses (`kind: "operational_announcement"`).
     - Test operational announcement prompt selection for text messages.
2. **End-to-End Regression**:
   - Run the full suite (`npm run check:all`): all 79+ test suites must pass cleanly.
