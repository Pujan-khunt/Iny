# GitHub Copilot Repository Instructions for Iny

Iny is a multi-turn AI assistant designed for educational interactions over WhatsApp, built using strict Hexagonal (Ports & Adapters) Architecture in TypeScript.

---

## 1. Canonical Sources of Truth
Always consult and adhere to these documents before proposing or evaluating changes:
1. **System Architecture (`docs/ARCHITECTURE.md`)**: The definitive map of the codebase, Hexagonal boundaries, ports, adapters, and flow of control.
2. **Agent Operating Contract (`AGENTS.md`)**: The repository's Zero-Trust operating rules, 5-step lifecycle, and Conventional Commits standard.
3. **Active Specifications (`docs/specs/`)**: Active business logic and contracts for features currently in progress.

---

## 2. Non-Negotiable Architectural Invariants

### Invariant 1: Hexagonal Purity (`src/core/`)
- `src/core/` contains pure domain entities, use cases, and port interfaces.
- **Zero External Runtime Dependencies**: `src/core/` must never import external npm libraries (e.g. no OpenAI SDK, Zod, Pino, Axios, etc.). Only pure TypeScript and Node.js built-ins (such as `node:crypto`) are permitted.

### Invariant 2: Directional Adapters
- Inbound drivers (e.g., CLI, WhatsApp webhooks) live strictly in `src/adapters/inbound/`.
- Outbound gateways implementing core ports live strictly in `src/adapters/outbound/`.
- Adapters depend inward on core ports. Core never imports from adapters.

### Invariant 3: Single Composition Root
- In production runtime code, only `src/index.ts` is permitted to wire and inject root adapters into use cases.
- Unit tests and internal adapter factories (like `PinoLoggerAdapter.child()`) may instantiate adapters directly.

### Invariant 4: Turn-Atomic Conversation Memory
- Conversation history is managed strictly in discrete, whole `DialogueTurn` units.
- Sliding window retrieval (`getRecentTurns`) must never slice across the middle of a turn. Assistant tool calls and their corresponding `ToolMessage` outputs must always remain together to prevent LLM wire-format validation errors.

### Invariant 5: Boundary Configuration Validation
- Environment variables and external configuration are parsed, coerced, and validated fail-fast at the application boundary using Zod in `src/config.ts`.
- Core use cases receive typed configuration parameters and should not duplicate defensive schema parsing.

---

## 3. LLM & Wire-Format Invariants (DeepSeek & OpenAI)

- **Assistant Tool Content**: When an assistant message contains `tool_calls`, its `content` on the wire must be `null` (not `""` or whitespace) to satisfy OpenAI-compatible API schemas.
- **DeepSeek Thinking Mode Replay**: DeepSeek models in thinking mode generate `reasoning_content`. When replaying assistant tool calls in subsequent ReAct iterations, `msg.thought` must be mapped back to `reasoning_content` on the assistant payload; otherwise, the API rejects the request with HTTP 400 Bad Request.
- **Forced Synthesis**: When the maximum tool iterations are reached, invoke `llm.generateResponse` with `{ forcedSynthesis: true }`, which withholds the `tools` parameter to force natural language completion.

---

## 4. Testing & Code Quality Standards

- **Test Framework**: Vitest (`npm test`). All unit tests must verify runtime behavior, edge cases, error conditions, and concurrency (not mock tautologies).
- **TypeScript Compilation**: `npm run build` (`tsc -p tsconfig.build.json`) must pass with 0 errors.
- **Commits**: Follow Conventional Commits format (`type(scope): description` with a required body wrapped at 72 characters explaining motivation and contrasting previous behavior). Do not commit without explicit user instruction.
