# System Prompt Composition Subsystem & Behavioral Guardrails Specification

## 1. Problem Statement & Motivation

When a user submits a concise food inquiry (e.g. `"Menu"`), the DeepSeek reasoning language model (e.g. DeepSeek-R1 / DeepSeek-V3) performs unnecessary chain-of-thought exploration rather than adhering to established deterministic subsystem rules.

Specifically, when the model receives the message timestamp (e.g. `10:52 PM IST`), its reasoning scratchpad deduces that dinner has concluded and begins speculating across multiple alternative possibilities. Instead of trusting the tool's deterministic parameter resolution:

1. The model speculatively calculates potential meal slots and calendar dates itself.
2. The model dispatches **multiple parallel tool calls** (e.g. invoking `display_mess_card` simultaneously for tomorrow's breakfast and today's ended dinner) to "probe" or "see patterns".
3. Because both tool calls succeed and declare `isTerminal: true`, the `AgentLoop` All-or-Nothing Early Termination rule fires and concatenates both card outputs, delivering two meal cards to the user.

Additionally, `SYSTEM_PROMPT` is currently configured as a raw environment variable string in `.env` and `src/config.ts`. This structure prevents version-controlled maintenance of operational rules, makes behavioral instructions fragile across environments, and leads to context pollution. Prompt adjustments must be managed through version control (VCS) inside the domain core.

Furthermore, a system prompt is a **strict operational requirement** for the agent loop, never an optional parameter. If a system prompt is missing or empty, the system must fail fast immediately.

## 2. Requirements & Domain Logic

### 2.1 Persona & Campus Identity

- **Identity**: Iny, an intelligent, concise, and helpful campus WhatsApp assistant for students at **SST (Scaler School of Technology)**.
- **Tone**: Direct, friendly, natural, and efficient; zero conversational fluff, unnecessary pleasantries, or robotic disclaimers.

### 2.2 Official WhatsApp Markdown Formatting Rules

Iny must strictly adhere to official WhatsApp formatting capabilities ([WhatsApp Formatting Guidelines](https://faq.whatsapp.com/539178204879377/?cms_platform=web)):

- **Supported Formats**:
  - `*bold*`: Wrap text in single asterisks for emphasis and section headers.
  - `_italic_`: Wrap text in single underscores for secondary descriptions.
  - `~strikethrough~`: Wrap text in tildes for revisions or cancellations.
  - `monospace`: Wrap text in triple backticks for code blocks or fixed-width text.
  - Bulleted lists: Prefix items with `* ` or `- `.
  - Numbered lists: Prefix items with `1. `, `2. `, etc.
  - Quotes: Prefix lines with `> `.
  - Inline code: Wrap text in single backticks `` `text` ``.
- **Unsupported / Prohibited Elements**:
  - Never use Markdown `#` headings (they render as literal hashtag characters in WhatsApp).
  - Never use Markdown tables (pipes `|` and dashes `-` do not format into tables).
  - Never use double asterisks `**bold**` (renders with visible extra asterisks).
  - Never use Markdown hyperlinks `[label](url)` (WhatsApp does not render markdown links; write raw URLs directly).

### 2.3 Tool Delineation & Execution Discipline

The system contains two distinct tools in the mess subsystem: `display_mess_card` and `query_mess_details`.

- **`display_mess_card` (Terminal Presentation Tool)**:
  - Exclusively for displaying official formatted meal cards, menus, caterer dishes, and seating locations.
  - Designed as a 1-per-query tool directly aligned with user intent.
  - **Hard Guardrail for Mess Presentation**: The model must **never** dispatch multiple parallel or speculative calls to `display_mess_card` (e.g. querying breakfast and dinner together to probe what is active). Exactly **one** `display_mess_card` call may be made per menu request.
  - **Trust Deterministic Engine Defaults**: When the user asks a general food or menu question (e.g. `"menu"`, `"food"`, `"what is there to eat?"`), the model must **not** calculate dates, deduce cutoff hours, or guess active meal slots. The model must call `display_mess_card({})` with an empty argument payload so that the backend deterministic cutoff and rollover engine resolves the active slot and date automatically.
- **`query_mess_details` (Conversational Analytical Tool)**:
  - Exclusively for analytical dietary questions, dish existence, or comparative queries (e.g. "does lunch have paneer?", "who is serving chicken today?", "is there ice cream for dinner?").
  - Returns raw structured JSON (`ResolvedMealInfo`) with `isTerminal: false`; the assistant synthesizes a direct answer in natural WhatsApp text.
  - Must **never** be used for generic menu inquiries or standard meal card displays.
- **Scope of Parallelism Guardrail**:
  - Parallel tool calling is **not** globally disabled across all future tools or subsystems.
  - The single-call and no-speculation constraint is enforced specifically for the mess meal presentation workflow (`display_mess_card`).

### 2.4 Tool Self-Documentation & Schema Enhancements

To ensure tool definitions are on point and unambiguous:

#### 2.4.1 `DisplayMessCardTool.ts`

- **Tool Description**: Upgrade from `'Serves 95% of standard meal and location lookups.'` to:
  `'Renders formatted WhatsApp mess meal cards across 4 presentation quadrants: ' +`
  `'(1) Slot query (e.g. "what\'s for lunch") -> pass mealSlot; ' +`
  `'(2) Single-vendor slot (e.g. "cheftalk lunch") -> pass mealSlot and vendor; ' +`
  `'(3) Generic menu (e.g. "menu", "food", "what to eat") -> pass {} (omit all args) for automatic cutoff/rollover; ' +`
  `'(4) Single-vendor full-day (e.g. "tcb menu") -> pass vendor (omit mealSlot). ' +`
  `'Output is terminal. Call at most once per turn; never call speculatively in parallel.'`
- **Parameter Schemas**:
  - `mealDate`: `'ISO calendar date in YYYY-MM-DD format. Omit for current or upcoming meals. Provide ONLY when the user explicitly specifies a calendar date (e.g. "tomorrow", "Monday", "2026-10-27").'`
  - `mealSlot`: `'Meal slot: "breakfast", "lunch", or "dinner". Provide ONLY if explicitly mentioned by name. Omit for general queries ("menu", "food", "what is there to eat?") to trigger automatic cutoff and rollover.'`
  - `vendor`: `'Mess caterer: "cheftalk_regular", "cheftalk_jain", or "tcb" (The Culinary Bay / Uniworld). Omit if no caterer is specified to display all caterers.'`

#### 2.4.2 `QueryMessDetailsTool.ts`

- **Tool Description**: Upgrade from `'Queries raw structured mess meal information (dishes, seating locations, extensions, live substitutions) for analytical dietary reasoning.'` to:
  `'Queries raw structured mess meal data (dishes, seating locations, extensions, live substitutions) strictly for specific dietary, ingredient, or comparative questions (e.g. "is there paneer in lunch?", "who is serving chicken today?"). Do NOT use this tool for showing general menus or meal cards (use display_mess_card instead).'`
- **Parameter Schemas**:
  - `mealDate`: `'ISO calendar date in YYYY-MM-DD format. Omit to query current or upcoming meal date.'`
  - `mealSlot`: `'Meal slot: "breakfast", "lunch", or "dinner". Omit to query all slots for the date.'`
  - `vendor`: `'Optional vendor caterer: "cheftalk_regular", "cheftalk_jain", or "tcb". Omit to query across all vendors.'`

### 2.5 Strict System Prompt Invariant & Configuration Elimination

- `SYSTEM_PROMPT` is **strictly required** across the application. It is never optional and never nullable.
- `AgentLoopConfig.systemPrompt` is a required `string` (must be non-empty; constructor throws if empty or omitted).
- `SYSTEM_PROMPT` is completely removed from `src/config.ts` (`envSchema`), `.env.example`, and `.env`.
- In `src/index.ts`, the composition root imports `SYSTEM_PROMPT` directly from `src/core/prompts/SystemPrompt.ts` and injects it into `AgentLoop`.

## 3. Architecture & Hexagonal Placement

The prompt composition logic resides inside the Hexagonal Domain Core (`src/core/prompts/`), maintaining zero external dependencies:

```
src/
├── core/
│   ├── prompts/
│   │   └── SystemPrompt.ts          # Pure domain system prompt constant & modular sections
│   ├── utils/
│   │   └── Temporal.ts              # Centralized IST temporal utilities
│   └── use-cases/
│       └── AgentLoop.ts             # Consumes required systemPrompt; injects temporal grounding
├── tools/
│   ├── DisplayMessCardTool.ts       # Enhanced description & 4-quadrant schemas
│   └── QueryMessDetailsTool.ts      # Enhanced description & dietary analytical boundary
├── config.ts                        # SYSTEM_PROMPT removed from envSchema
└── index.ts                         # Injects SYSTEM_PROMPT from src/core/prompts/SystemPrompt
```

## 4. API Contracts

### 4.1 `src/core/prompts/SystemPrompt.ts`

```typescript
/** Composable prompt sections */
export const BASE_PERSONA: string;
export const WHATSAPP_FORMATTING_RULES: string;
export const TOOL_DISCIPLINE_RULES: string;
export const MESS_ROUTING_RULES: string;

/**
 * Standard compiled system prompt for Iny.
 * Composed by joining BASE_PERSONA, WHATSAPP_FORMATTING_RULES,
 * TOOL_DISCIPLINE_RULES, and MESS_ROUTING_RULES.
 * Strictly non-empty.
 */
export const SYSTEM_PROMPT: string;
```

### 4.2 `src/core/use-cases/AgentLoop.ts`

```typescript
export interface AgentLoopConfig {
	/**
	 * Static base system prompt instructing the language model on persona and rules.
	 * Strictly required; must be a non-empty string.
	 */
	systemPrompt: string;
	/** Maximum number of tool execution cycles before forcing text synthesis. Defaults to 5. */
	maxToolIterations?: number;
}
```

In `AgentLoop` constructor:

```typescript
if (!config.systemPrompt || config.systemPrompt.trim() === "") {
	throw new Error("AgentLoop requires a non-empty systemPrompt");
}
```

In `AgentLoop.run()`:

```typescript
const effectiveSystemPrompt = buildTemporallyGroundedSystemPrompt(
	this.systemPrompt,
	userMessage.timestamp,
);
```

### 4.3 `src/index.ts` (Composition Root)

```typescript
import { SYSTEM_PROMPT } from "./core/prompts/SystemPrompt";

// 7. Autonomous AgentLoop
const agentLoop = new AgentLoop(deepseekAdapter, registry, {
	maxToolIterations: config.MAX_TOOL_ITERATIONS,
	systemPrompt: SYSTEM_PROMPT,
});
```

### 4.4 `src/config.ts`

`SYSTEM_PROMPT` is removed from `envSchema`. The `Config` type no longer contains `SYSTEM_PROMPT`.

## 5. Edge Cases & Invariants

1. **Strictly Required Invariant**:
   - `systemPrompt` must be a non-empty string. Attempting to construct `AgentLoop` with an empty or whitespace-only `systemPrompt` throws an immediate Error.
2. **Turn Invariance**:
   - The effective system prompt on each turn is grounded in the triggering inbound user message's timestamp via `buildTemporallyGroundedSystemPrompt`.
3. **Constitution Invariants**:
   - `src/core/prompts/SystemPrompt.ts` contains zero external dependencies.
   - All imports use extensionless paths (`./Temporal`).
   - Centralized temporal formatting in `src/core/utils/Temporal.ts` eliminates duplicate date/time logic across the codebase.
   - Public functions and constants include complete JSDoc without em dashes.

## 6. Verification & Testing Strategy

1. **Prompt Tests (`tests/core/prompts/SystemPrompt.test.ts`)**:
   - Verify `SYSTEM_PROMPT` includes `BASE_PERSONA` (mentioning SST), `WHATSAPP_FORMATTING_RULES`, `TOOL_DISCIPLINE_RULES`, and `MESS_ROUTING_RULES`.
   - Verify all exported section constants are non-empty strings.
2. **AgentLoop System Prompt Validation Tests (`tests/core/use-cases/AgentLoop.test.ts`)**:
   - Verify that `AgentLoop` throws an error when initialized with an empty string or whitespace `systemPrompt`.
   - Verify that `AgentLoop` correctly applies temporal grounding to `systemPrompt` on each turn.
3. **Tool Description Verification (`tests/tools/DisplayMessCardTool.test.ts` & `tests/tools/QueryMessDetailsTool.test.ts`)**:
   - Verify that `DisplayMessCardTool.description` reflects the updated 4-quadrant routing documentation.
   - Verify that `QueryMessDetailsTool.description` reflects the analytical dietary query boundary.
4. **Configuration Tests (`tests/config.test.ts`)**:
   - Remove assertions expecting `SYSTEM_PROMPT` in `envSchema`.
   - Verify configuration loads successfully when `SYSTEM_PROMPT` is absent from the environment.
5. **Full Regression Suite**:
   - Execute `npm run check:all` (`format:check`, `lint`, `deadcode`, `typecheck`, `test`) to confirm zero regressions across all existing tests.
