---
applyTo: 'src/core/**/*.ts'
---

# Core Domain Boundary Rules (`src/core/`)

You are inspecting, reviewing, or modifying files within `src/core/`. This directory represents the pure Hexagonal core of the application (Domain Entities, Ports, and Use Cases).

---

## 1. Zero External Runtime Dependencies (Strict)
- **No 3rd-Party Imports**: Under no circumstances may any file in `src/core/` import an external npm dependency.
  - ❌ `import { z } from 'zod';`
  - ❌ `import OpenAI from 'openai';`
  - ❌ `import pino from 'pino';`
  - ❌ `import axios from 'axios';`
- **Permitted Imports**:
  - Other modules within `src/core/` (e.g., entities and ports).
  - Pure TypeScript language types and utility types.
  - Node.js native built-ins only when strictly necessary (e.g., `import crypto from 'node:crypto';` for UUID generation).

---

## 2. Structural Layer Responsibilities

### Entities (`src/core/entities/`)
- Must represent pure business domain models and types (e.g., `Message`, `DialogueTurn`).
- Use strict TypeScript discriminated unions for polymorphic records (e.g., `role: 'user' | 'assistant' | 'tool'`).
- Must not contain I/O logic, database access, or network transport concerns.

### Ports (`src/core/ports/`)
- Must be pure TypeScript interfaces or type definitions.
- Represent primary (driving/inbound) and secondary (driven/outbound) boundaries.
- Ports must never reference concrete adapters or third-party SDK types.

### Use Cases (`src/core/use-cases/`)
- Encapsulate business workflow orchestration (e.g., `ProcessIncomingMessage`).
- **Dependency Inversion**: All external interactions (sending messages, querying LLMs, persisting turns, logging) must be injected via Port interfaces in the constructor.
- **Config Ingestion**: Accept plain TypeScript config interfaces. Do not perform defensive runtime schema validation; rely on the composition root and boundary validation (`src/config.ts`) to provide valid parameters.
- **Resilience**: Must gracefully handle port failures, reflect tool errors back to the conversation loop when appropriate, and ensure unhandled exceptions do not cause silent event-loop failures.

---

## 3. Review Checklist for `src/core/` PRs
When reviewing diffs affecting `src/core/**`:
- [ ] Are all imports strictly internal to `src/core/` or native Node.js built-ins?
- [ ] Does any use case instantiate a concrete adapter? (Must be flagged as Critical).
- [ ] Are domain models immutably handled where necessary to prevent cross-turn state pollution?
- [ ] Are all async operations cleanly awaited with appropriate error boundaries?
