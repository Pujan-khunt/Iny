---
status: accepted
date: 2026-09-18
decision-makers: Pujan Khunt
---

# Adopt Inbound and Outbound Adapter Terminology

## Context and Problem Statement

In Hexagonal Architecture (Ports and Adapters), adapters are traditionally divided into two categories:
1. **Driving (Primary) Adapters:** Components that take external inputs and drive application use cases (e.g. CLI, HTTP controllers, webhooks).
2. **Driven (Secondary) Adapters:** Components that are driven by the application core to perform operations in the outside world (e.g. database gateways, LLM clients, logging services).

While "driving" and "driven" are academically established in Alistair Cockburn's original pattern, their active/passive grammatical distinction frequently causes confusion for engineers and AI coding assistants. Team members frequently have to pause and deduce: *"Is this component driving or driven?"*

How should Iny categorize and name its adapter layers to ensure clear, intuitive communication across directory structures, code, tests, and documentation?

## Decision Drivers

- **Intuitive Mental Model:** Directory and component names should immediately convey the direction of data flow (into the core vs. out of the core) without requiring knowledge of Hexagonal terminology nuances.
- **Developer & Agent Experience:** New contributors and agentic coding assistants should instinctively know where new adapters belong.
- **Architectural Clarity:** Maintain strict Hexagonal boundaries (adapters depend on core ports; core never depends on adapters).
- **Preservation of Historical Documentation:** Project plans and specifications drafted prior to September 18, 2026 (located in `docs/superpowers/`) used `driving` and `driven`. We need an authoritative living record explaining the transition without mutating immutable historical records.

## Considered Options

- **Option 1:** `inbound` and `outbound` (Chosen)
- **Option 2:** `driving` and `driven` (Original Cockburn terminology)
- **Option 3:** `primary` and `secondary`

## Decision Outcome

Chosen option: **"Option 1: inbound and outbound"**, because:
- **Directional Clarity:** "Inbound" clearly signifies external events entering the core. "Outbound" clearly signifies calls leaving the core to external systems.
- **Industry Alignment:** Modern Hexagonal and Clean Architecture ecosystems (such as Spring, NestJS, and DDD practitioner guides) predominantly favor Inbound/Outbound for filesystem layout.
- **Zero Ambiguity:** Eliminates the cognitive translation step between the words "driving/driven" and the actual data flow.

### Consequences

- **Good:** Directory structure is immediately clear:
  - `src/adapters/inbound/` (e.g. `cli`, future `whatsapp`)
  - `src/adapters/outbound/` (e.g. `llm`, `logger`, `plugin-registry`)
- **Good:** Test directories mirror source code exactly (`tests/adapters/inbound/` and `tests/adapters/outbound/`).
- **Good:** New adapters have an unambiguous placement rule based on flow of control.
- **Neutral:** Historical documentation written prior to 2026-09-18 in `docs/superpowers/plans/` and `docs/superpowers/specs/` retains the older `driving` and `driven` terms. These documents represent point-in-time execution logs and are deliberately preserved in their original form.

## Implementation Plan

- **Affected paths**:
  - `src/adapters/inbound/` (renamed from `src/adapters/driving/`)
  - `src/adapters/outbound/` (renamed from `src/adapters/driven/`)
  - `tests/adapters/inbound/` (renamed from `tests/adapters/driving/`)
  - `tests/adapters/outbound/` (renamed from `tests/adapters/driven/`)
  - `src/index.ts` (updated import paths)
- **Patterns to follow**:
  - Adapters that receive user input or external webhooks and invoke use cases must live in `src/adapters/inbound/<name>/`.
  - Adapters that implement ports defined in `src/core/ports/` to communicate with external infrastructure must live in `src/adapters/outbound/<name>/`.
- **Patterns to avoid**:
  - Do not introduce `driving` or `driven` directories in future work.
  - Do not modify historical documents in `docs/superpowers/` dated prior to 2026-09-18 to "fix" terminology, as those are immutable execution records.

### Verification

- [x] All adapter directories in `src/adapters/` are named `inbound/` and `outbound/`.
- [x] All test directories in `tests/adapters/` are named `inbound/` and `outbound/`.
- [x] `npm run build` compiles with zero import errors.
- [x] `npm test` passes all tests.

## Pros and Cons of the Options

### Option 1: inbound and outbound

- Good, because direction of communication is explicit in the name.
- Good, because it prevents confusion between active and passive voice.
- Good, because it is the prevailing naming convention in modern production TypeScript projects.
- Neutral, because it slightly deviates from Cockburn's original 2005 terminology papers, while retaining the exact same architectural semantics.

### Option 2: driving and driven

- Good, because it adheres strictly to classic Hexagonal Architecture literature.
- Bad, because "driving" vs "driven" is easy to mix up (one letter difference, non-directional).
- Bad, because contributors unfamiliar with classic Hexagonal papers struggle to remember which is which.

### Option 3: primary and secondary

- Good, because it distinguishes initiator from responder.
- Bad, because "primary" can mistakenly imply importance rather than role (e.g. thinking an LLM outbound adapter is "secondary" in importance when it is a core capability).

## More Information

- Implementation merged in Pull Request [#7](https://github.com/Pujan-khunt/Iny/pull/7) (commit `ff7d395`).
- For any questions regarding historical plans or specifications mentioning `driving` or `driven`, refer to this ADR as the governing policy.
