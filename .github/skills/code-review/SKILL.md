---
name: code-review
description: Comprehensive code review workflow and rubric for evaluating Pull Requests in Iny. Enforces Hexagonal architecture, wire-format compatibility, turn-atomic conversation memory, and test rigor.
---

# Code Review Skill for Iny Pull Requests

When reviewing a pull request in this repository, act as a Senior Software Architect. Your responsibility is to ensure that code entering the codebase strictly adheres to Hexagonal Architecture, maintains wire-format safety with LLM providers, protects conversation memory invariants, and includes rigorous automated tests.

---

## 1. Review Workflow

1. **Understand Intent & Context**:
   - Check the PR description and locate the relevant active or archived specification in `docs/specs/` to understand intended business logic.
   - Reference `docs/ARCHITECTURE.md` as the definitive map of system boundaries and control flow.
2. **Systematic Rubric Evaluation**:
   - Evaluate the diff against the specific rubrics detailed in Section 2.
3. **Calibrate Severity**:
   - Distinguish strictly between **Critical (Must Fix)**, **Important (Should Fix)**, and **Minor (Nice to Have)** issues.
4. **Constructive Feedback**:
   - Praise well-engineered patterns, clean tests, and sound abstractions.
   - For any issue raised, explain **what** is wrong, **why** it matters, and provide a concrete, ready-to-use TypeScript code snippet demonstrating the fix.

---

## 2. Iny Code Review Rubric

### A. Hexagonal Architecture & Boundary Rules
- [ ] **Core Purity**: Verify that no file under `src/core/` imports any third-party npm package (e.g. `zod`, `openai`, `pino`, `axios`).
- [ ] **Adapter Inversion**: Inbound drivers live in `src/adapters/inbound/`; outbound gateways live in `src/adapters/outbound/`. Adapters must depend on core ports, never core on adapters.
- [ ] **Single Composition Root**: All runtime adapter instantiations and dependency injections must occur strictly in `src/index.ts`.
- [ ] **Boundary Configuration**: Environment variables must be validated fail-fast in `src/config.ts` via Zod. Core use cases must receive typed configuration interfaces and avoid duplicating defensive type parsing.

### B. LLM Provider & Wire-Format Integrity (DeepSeek / OpenAI)
- [ ] **Null Content on Tool Calls**: When an assistant message contains `tool_calls`, ensure its payload `content` is serialized as `null` (not `""` or whitespace) to prevent provider validation errors.
- [ ] **Reasoning Content Replay**: For DeepSeek thinking-mode / V4.1 Flash models, verify that previous assistant tool turns map `msg.thought` back to `reasoning_content` in the outbound payload. Omitting this triggers HTTP 400 Bad Request during multi-turn loops.
- [ ] **Forced Synthesis Protocol**: When `forcedSynthesis: true` is set (e.g., at circuit breaker thresholds), verify that the `tools` parameter is completely omitted from the API request to guarantee a natural language response.
- [ ] **Defensive Argument Parsing**: Ensure tool arguments are parsed defensively. Malformed JSON or non-object arguments must reflect an explicit `_parseError` into the `ToolMessage` rather than defaulting to empty objects, enabling the LLM to self-correct.

### C. Conversation Memory & Resilience
- [ ] **Turn Atomicity**: Verify that conversational memory is stored and retrieved strictly as complete `DialogueTurn` units. Slicing must never separate tool calls from their tool execution results.
- [ ] **Delivery-First Error Safety**: If an answer was already delivered to the user via `MessageSenderPort`, subsequent persistence failures (e.g., in `chatRepository.saveTurn`) must log fatal errors but suppress contradictory "An error occurred" notifications to the user.
- [ ] **Fallback on Empty Output**: Verify defensive fallbacks exist if the LLM produces empty or whitespace-only content, preventing blank messages on WhatsApp transport.
- [ ] **Memory Bounding**: Ensure in-memory collections have defined upper bounds (e.g., `maxRetainedTurns` in `InMemoryChatRepository`) to avoid unbounded heap growth.

### D. Concurrency & Event-Loop Safety
- [ ] **Parallel Tool Execution**: Independent tool calls returned by the model must be executed concurrently via `Promise.all` with individual error handling boundaries.
- [ ] **ReAct Loop Termination**: The while-loop must make guaranteed progress on every branch (including an `else` fallthrough on unrecognized response types) to prevent freezing the Node.js event loop.

### E. Test Suite Rigor
- [ ] **Real Runtime Verification**: Tests must verify actual runtime behaviors, edge cases, error conditions, and concurrency—not mock tautologies.
- [ ] **Passing Suite & Clean Build**: All Vitest tests must pass (`npm test`) and TypeScript build compilation must produce 0 errors (`npm run build`).

---

## 3. Review Report Format

Format your review following this structure:

```markdown
### Summary
[Brief 1-2 sentence assessment of the PR]

### Strengths
- [Highlight good design decisions, clean tests, or elegant handling]

### Issues

#### Critical (Must Fix before merge)
*Issues that cause crashes, architectural violations, security risks, or wire-format 400 errors.*
- **File:Line**: [Description of issue]
  - **Why it matters**: [Technical impact]
  - **Proposed Fix**:
    ```typescript
    // Code snippet
    ```

#### Important (Should Fix before merge)
*Edge case omissions, lack of fallback handling, or missing error reflections.*
- **File:Line**: [Description]

#### Minor (Nice to Have)
*Refactoring opportunities, naming improvements, or documentation cleanups.*
- **File:Line**: [Description]

### Verdict
**[Approved | Changes Requested]** - [Clear concluding sentence]
```
