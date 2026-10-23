# Iny Low-Level Design Constitution

This document serves as the binding single-page rulebook governing low-level design (LLD), hexagonal purity, code shape, and anti-slop engineering standards across Iny. Every agent, subagent, and human contributor operating within this repository must adhere strictly to these ten invariants without exception.

---

## 1. Architectural Zones & Inward Dependency Flow

```text
[Inbound Adapters] ──▶ [Core Ports] ◀── [Outbound Adapters]
(CLI, WhatsApp)             ▲            (Postgres, Baileys, LLM)
                            │
                    [Core Use Cases]
                            │
                    [Core Entities]
```

- **Domain Core (`src/core/`)**: 100% pure TypeScript. Zero external runtime dependencies.
- **Inbound Adapters (`src/adapters/inbound/`)**: Drive the system via Core Use Cases or Core Ports only.
- **Outbound Adapters (`src/adapters/outbound/`)**: Driven implementations of Core Ports only.
- **Tools (`src/tools/`)**: Capabilities extending `BaseTool` and depending only on Core Ports.
- **Composition Root (`src/index.ts`)**: The sole runtime wiring point injecting adapters into use cases.

---

## 2. The 10 Binding Invariants

### 1. Port-First Contract
Every outbound capability (database persistence, external APIs, messaging transports, LLM inference, logging) MUST declare an explicit TypeScript interface in `src/core/ports/` before or atomically with its adapter implementation.
- Driven adapters must declare an explicit `implements <PortName>` clause.
- Phantom ports (ports referenced in architecture documentation or adapters but absent from `src/core/ports/`) are strictly prohibited.
- Canonical examples: `MessStagingRepositoryPort`, `ChatRepositoryPort`, `LLMPort`, `LoggerPort`.

### 2. Inward Boundary Isolation
Inbound driving adapters (`src/adapters/inbound/`) must never import outbound driven adapters (`src/adapters/outbound/`) or raw database infrastructure (`PgDatabase`, Drizzle table schemas).
- Driving adapters must initiate workflows exclusively through core use cases or query data via core port interfaces.
- Bypassing the core domain to execute raw SQL queries inside driving adapters is a critical boundary breach.
- Anti-pattern: `FoodAnnouncementsInboundAdapter` directly querying PostgreSQL or `TriageCliController` importing concrete `PostgresMessStagingRepository`.

### 3. Tool Boundary Isolation
Domain capability tools in `src/tools/` must depend solely on `src/core/ports/` and `src/tools/BaseTool.ts`.
- Tools must never import outbound adapters or presentation formatters (e.g., `DisplayMessCardTool` importing `MessCardRenderer`).
- Formatting, serialization, and presentation logic belong in dedicated presentation services or outbound adapters, never inside tool execution routines.

### 4. 150-Line Source File Limit
No production source file in `src/` may exceed 150 lines (excluding relational table schemas in `schema.ts`).
- When a source file approaches 130 lines, it must be evaluated for Single Responsibility decomposition.
- Monolithic god classes must be factored into focused, cohesive collaborators (e.g., decomposing a large repository into distinct staging queue, meal committer, and rollback units).

### 5. 40-Line Function Limit
No function, method, or constructor may exceed 40 lines of code.
- Nested callbacks, SQL template blocks, and transaction closures count toward the parent function's line budget.
- Complex multi-step operations must be decomposed into private helper functions or dedicated domain collaborators with single, self-explanatory responsibilities.

### 6. 3-Level Nesting Limit
Control flow nesting (`if`, `for`, `while`, `try/catch`, callbacks) must never exceed a maximum depth of 3 levels.
- Deeply nested branch structures must be flattened using early return guard clauses, polymorphic dispatch, or extracted helper functions.
- Avoid cascading `if-else` pyramids; validate prerequisites upfront and return immediately on failure.

### 7. No Test-Only Exports
Every exported function, class, interface, and constant must have at least one production call site.
- Internal helper methods and intermediate data structures must never be exported solely to facilitate white-box unit tests.
- Modules must be tested strictly through their public API surface. Private implementation details remain private.

### 8. Single Responsibility & Cohesion
Entity files in `src/core/entities/` must define pure domain data structures and contracts only; they must contain zero operational utility logic.
- Time, date, and timezone operations must be centralized in dedicated utilities (`src/core/utils/Temporal.ts`) or domain services.
- Ad-hoc, scattered date arithmetic and duplicate timezone formatters across adapters are prohibited.

### 9. Zero Speculative Boilerplate (Slopnought Anti-Slop Catalog)
Never introduce speculative code, premature abstractions, or dead scaffolding for hypothetical future requirements:
- **No Uncalled Factories**: Do not create factory classes (e.g., `MessMealFactory`) unless actively invoked by production runtime code.
- **No Dummy Wrappers**: Do not write thin forwarding classes or pass-through adapters that add zero semantic value.
- **No Polymorphic Ghosts**: Do not write generic base classes, configuration flags, or multi-tenant hooks for unbuilt features.
- If an entity, interface, or helper is not actively consumed by the current feature, delete it immediately.

### 10. Strict Convention Conformance
Every source file in the repository must adhere to canonical project conventions:
- **Extensionless Imports**: All TypeScript imports must omit file extensions (`.js` or `.ts`).
- **Uniform Constructor Dependency Injection**: All dependencies must be injected via constructor parameters. Never use optional chaining on required dependencies (`this.logger?.info?.()`) and never supply inline dummy fallback stubs (`noopLogger`).
- **Exhaustive JSDoc**: Every public class, interface, port, and exported method must feature standard JSDoc documenting parameter semantics, return contracts, and failure modes without em dashes (`—`).

---

## 3. Review Severity & Mechanical Verification

Violations encountered during design review, automated verification, or code review are categorized as follows:
- **P0 (Blocking / Hard Failure)**:
  - Violations of Rules 1, 2, or 3 (boundary breaches, direct database access from inbound adapters, missing port contracts).
  - File size exceeding 150 lines (Rule 4) or function length exceeding 40 lines (Rule 5).
  - Unused or test-only exports (Rule 7) and speculative boilerplate / dead code (Rule 9).
  - *Action*: Commit blocked; pull request cannot merge until remediated.
- **P1 (Important / Correction Required)**:
  - Nesting depth exceeding 3 levels (Rule 6).
  - Cohesion fragmentation or scattered date arithmetic (Rule 8).
  - Import extension drift, defensive optional chaining on dependencies, or incomplete JSDoc (Rule 10).
  - *Action*: Must be addressed before branch finalization unless explicitly waived by repository owner.
- **P2 (Minor / Advisory)**:
  - Local identifier naming refinements or non-architectural stylistic micro-optimizations.

Verification command: `npm run check:all` (`format:check`, `lint`, `deadcode`, `typecheck`, `test`).
