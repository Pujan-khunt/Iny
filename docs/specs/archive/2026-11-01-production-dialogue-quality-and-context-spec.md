# Iny Production Dialogue Quality & Context Integrity Specification

## 1. Overview & Business Objectives

Iny is a campus WhatsApp assistant for students at Scaler School of Technology (SST). A production audit across 62 dialogue turns (Oct 26 – Nov 1, 2026) revealed that while conversational memory provides essential continuity (retaining student mess preferences, resolving follow-up seating queries, tolerating typos), the unconstrained replay of past tool payloads and missing temporal metadata causes severe production failures:

1. **Stale Menu Delivery (Critical - T45)**: Serving yesterday's menu as "today" because the LLM assumes cached tool results from prior turns are fresh, skipping live tool calls.
2. **False Service Cancellations (T50)**: Escalating missing database records into claims that vendors are closed, cancelled, or on weekly holiday.
3. **Speculative Hallucinations (T35, T36, T51, T53, T56)**: Giving unsolicited nutritional advice (protein counts, crash warnings), recipe/taste speculations, and inventing multi-week schedule patterns.
4. **Severe Response Verbosity (T10, T11, T36, T57)**: Generating 60–215 words for simple yes/no or informational queries on mobile screens.
5. **Unsolicited Closing Questions (T45, T58, T59)**: Cluttering WhatsApp chats with unnecessary conversational pleasantries (_"Anything else?"_).
6. **Vendor Scope Bleed (T38, T41)**: Injecting unwanted vendors (e.g. TCB) into responses when a student specifically asks for "Cheftalk".

### Goal

Remediate these production flaws through strict context pruning, timestamped historical turns, hardened system prompt contracts, and deterministic tool fallback semantics, while preserving user preference memory and follow-up resolution.

---

## 2. Invariants & Architectural Principles

1. **Temporal Grounding Invariant**: The LLM must never receive historical user messages without an explicit IST timestamp. Stale turns must be temporally self-evident.
2. **Mandatory Live Tool Lookup**: Any user query referencing meals, items, timings, or availability for _any_ date/slot (current, upcoming, or past) **must** invoke a live tool call. Past conversation turns are strictly prohibited from serving as factual menu knowledge.
3. **Absence != Cancellation**: The absence of a database record indicates unuploaded data, never a cancellation, vendor closure, or holiday, unless an explicit database record (`cancellation` meal change) states so.
4. **DeepSeek Thinking Protocol Compliance**: Replaying `reasoning_content` and tool calls/results within the active turn must strictly adhere to DeepSeek API rules, but historical turns must not leak raw tool JSON payloads that confuse the model's factual memory.
5. **Hexagonal Purity & Constitution Compliance**: All domain logic and contracts remain pure TypeScript with zero external dependencies. File lengths must strictly respect the 150-line limit defined in `.agents/constitution.md`.

---

## 3. Functional Requirements & Domain Logic

### 3.1 Historical Context Pruning & Temporal Formatting

- **User Message Timestamping**:
  When formatting historical turns for the LLM in `DeepseekRequestMapper`, every historical `UserMessage` must be prefixed with its IST timestamp:

  ```text
  [Sent: YYYY-MM-DD HH:mm IST] <User Query>
  ```

  The active turn's user message remains clean (as it is temporally grounded by the system prompt's current time header).

- **Cross-Turn Tool Output Pruning**:
  - Within an **active turn** ReAct loop, tool call messages, tool result messages, and reasoning content are fully preserved as required by DeepSeek thinking-mode and tool-calling protocols.
  - Across **completed past turns**, historical context injected into new turns must include:
    - User messages (with timestamps)
    - Assistant text responses (final conversational answers)
  - Historical raw `tool` messages and `AssistantToolCallMessage`s from previous turns are **pruned** from multi-turn history.
  - _Rationale_: The assistant's previous text responses preserve conversational context (e.g. _"I showed you the lunch menu"_, _"Got it, you're subscribed to Cheftalk"_), while pruning raw tool payloads prevents the LLM from treating old menu cards as reusable ground truth.

- **Context Retrieval TTL**:
  - Configure a default TTL of 24 hours (`24 * 60 * 60 * 1000` ms) in the composition root (`src/index.ts`) for `DialogueTurnContextRetrievalAdapter`.
  - Turns older than 24 hours are excluded from LLM prompt history to prevent week-old conversational interference.

---

### 3.2 System Prompt & Response Contract Hardening

The system prompt (`src/core/prompts/SystemPrompt.ts`) must be updated with enforceable response contracts:

1. **Brevity & Length Bounds**:
   - **Direct Yes/No / Status Queries**: ≤ 25 words. Lead immediately with the direct answer (e.g., _"No, today has no non-veg items scheduled."_).
   - **General Informational Queries**: ≤ 45 words.
   - **Rendered Mess Cards**: Terminal rendered cards remain exempt (pre-rendered formats).
   - **Comparative / Multi-menu Analysis (Explicitly Requested)**: ≤ 80 words. Focused strictly on item differences.

2. **Negative Boundary Constraints (Strict Prohibitions)**:
   - **No Nutritional Speculation**: Never estimate calories, grams of protein/carbs, or health effects (no crash predictions, fitness commentary, or dietician roleplay).
   - **No Recipe or Taste Inventions**: Do not speculate on taste (earthy, tangy), spice levels, or cooking styles unless explicitly recorded in the menu data.
   - **No Schedule Guessing**: Never infer recurring patterns (e.g., _"Sunday is always aloo paratha"_) or unverified operational schedules.
   - **No Unsolicited Closers**: Never append conversational pleasantries or closing questions (_"Anything else?", "Want me to check seating?", "Let me know!"_).

3. **Tool Discipline Mandate**:
   - Live food facts rule: _"You have NO internal knowledge of SST mess menus. Even if a menu was discussed in a prior turn, if the user asks for a meal, you MUST call a tool. Reusing menu items from conversation history is strictly forbidden."_

---

### 3.3 Deterministic Tool Semantics & Error Handling

- **DisplayMessCardTool Missing Data Behavior**:
  - When `getResolvedMeal` returns zero meals for the requested date/slot/vendor:
    - `DisplayMessCardTool` must return a deterministic formatted notice:
      `"ℹ️ No menu data is currently loaded for <Vendor / Slot> on <Date>."`
    - It must set `isTerminal: true`.
    - _Impact_: Bypasses the second LLM call completely, preventing the LLM from synthesizing speculative claims like _"Cheftalk is not serving"_ or _"Breakfast is cancelled"_.

- **Cheftalk Vendor Disambiguation**:
  - When a user asks for "Cheftalk" without specifying Regular vs Jain (e.g. T38, T41):
    - The tool must support a vendor grouping or filter that returns Cheftalk Regular + Cheftalk Jain **without** including TCB (Uniworld).
    - If `vendor: "cheftalk"` is requested, `DisplayMessCardTool` renders both Cheftalk variants and suppresses TCB.

---

## 4. Edge Cases & Handling

| Scenario                               | Input / State                                                                      | Expected System Behavior                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Date Rollover in Conversation**      | User asked for lunch on Oct 30; asks "Today's lunch" on Oct 31.                    | Historical user message is tagged `[Sent: 2026-10-30 12:49 IST]`. Model recognizes date change, calls `display_mess_card`, returns Oct 31 menu. |
| **Missing New Month Menus**            | Tool returns 0 meals for Nov 1 Cheftalk.                                           | Terminal card returns deterministic message: _"ℹ️ No menu data is currently loaded..."_. No cancellation hallucination.                         |
| **Yes/No Query with Menu Details**     | _"is non-veg today?"_                                                              | Direct answer under 25 words: _"No, there are no non-veg dishes scheduled for today across any vendor."_ No massive multi-meal dumps.           |
| **Conversational Closing**             | User says _"Thanks!"_ or _"What is your name?"_                                    | Clean, concise one-sentence answer with NO trailing _"Anything else?"_ or questions.                                                            |
| **Remembered Subscription Preference** | User previously said _"I am subscribed to Cheftalk"_; asks _"Menu"_ 3 hours later. | Context preserves user message and assistant confirmation. Model calls `display_mess_card` with `vendor: "cheftalk_regular"`.                   |
| **Clarification Needed**               | Ambiguous user request (e.g. _"last three menus"_).                                | Single clarifying question allowed under 30 words (e.g., _"Do you mean the last 3 meals today, or the past 3 days of menus?"_).                 |

---

## 5. API & Interface Contracts

### 5.1 DeepseekRequestMapper Contract

- Input: `messages: Message[]`
- Transformation Rules:
  - Active turn messages (messages after the latest completed turn boundary): Mapped according to full ReAct/DeepSeek specification (`user`, `assistant` with `reasoning_content` and `tool_calls`, `tool` result).
  - Historical turns:
    - `UserMessage`: Mapped to `{ role: "user", content: "[Sent: YYYY-MM-DD HH:mm IST] " + msg.content }`
    - `AssistantTextMessage`: Mapped to `{ role: "assistant", content: msg.content }` (optional `reasoning_content` excluded from historical turns if tools are not active in that turn, or retained per API requirement).
    - `ToolResultMessage` & `AssistantToolCallMessage`: Filtered out from historical turns.

### 5.2 DisplayMessCardTool Contract Update

- Return type: `ToolResult`
- Behavior on zero meals:
  ```typescript
  {
    content: "ℹ️ No menu data is currently loaded for " + targetDescription + ".",
    isTerminal: true
  }
  ```

---

## 6. Verification & Acceptance Criteria

1. **Regression Replay Test Suite**:
   - Replay T45 ("Today's lunch" after day rollover): Must trigger a tool call and output Saturday's menu.
   - Replay T50 (missing Cheftalk breakfast): Must output deterministic "no menu data loaded" notice; zero mentions of "not serving" or "cancelled".
   - Replay T10/T11 ("is non-veg today?"): Response word count ≤ 25 words; zero closing questions.
   - Replay T58 ("what's your name?"): Single concise sentence; zero closing questions.
   - Replay T15 → T16: Vendor preference for Cheftalk persists across turns.
2. **Hexagonal Architecture & Constitution Compliance**:
   - All tests pass: `npm test` and `npm run build`.
   - File lengths: All modified and newly introduced files must be under 150 lines.
   - Zero external runtime dependencies in `src/core/`.
