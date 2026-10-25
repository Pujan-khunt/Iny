# Development Layer Specification: Design Quality & Architectural Governance

## 1. Overview & Motivation

AI coding agents reliably produce functional, test-passing code under TDD (Red-Green-Refactor) and feature specifications. However, without mechanical constraints on code shape and explicit architectural gates, agentic implementations consistently degrade low-level design (LLD) quality.

A comprehensive audit of Iny's codebase—specifically the recently merged mess subsystem (PR #21: 44 files, 13,051 lines)—confirmed the following critical design regressions:

1. **Architectural Boundary Violations**: Inbound driving adapters (`FoodAnnouncementsInboundAdapter`) directly inject database connections and execute raw SQL, bypassing core use cases. Inbound CLI controllers import outbound repositories directly. Domain tools (`DisplayMessCardTool`) import outbound presentation adapters.
2. **Phantom Port Contracts**: Ports documented in `docs/ARCHITECTURE.md` (e.g., `MessStagingRepositoryPort`) were never created in `src/core/ports/`, leading to untyped, unbounded outbound implementations.
3. **Domain Core Contamination**: `src/core/use-cases/AgentLoop.ts` was polluted with timezone formatting, prompt augmentation, terminal output delimiting, and early-termination predicates.
4. **God Classes & Deep Nesting**: Files such as `PostgresMessStagingRepository.ts` (658 lines), `TriageTerminalView.ts` (652 lines), and `TriageCliController.ts` (588 lines) bundle transactions, CLI rendering, validation, and domain transformations with up to 5 levels of nesting.
5. **Over-Exporting & Leaked Internals**: Modules export internal helpers solely to facilitate white-box unit tests, polluting module namespaces.
6. **Speculative & Dead Code**: Uncalled factory classes (`MessMealFactory`) exist solely to pass dedicated tests.
7. **Fragmented Cohesive Logic**: IST date manipulation was implemented across 5 distinct files using differing, inconsistent techniques.
8. **Convention Drift**: 38+ imports introduced explicit `.js` suffixes contrary to the established extensionless TypeScript import conventions.

This specification defines the **Development Layer**: a machine-checked, gated governance framework that prevents low-level design decay, enforces Hexagonal purity, integrates anti-slop taxonomies, and ensures every file in Iny remains understandable, maintainable, and verifiable by its human owner.

---

## 2. Architectural Invariants & Scope

1. **Hexagonal Boundary Enforcement**:
   - `src/core/`: 100% pure TypeScript. Zero external runtime dependencies (no database ORMs, no logging engines, no HTTP clients).
   - `src/adapters/inbound/`: Depends exclusively on `src/core/` use cases and port interfaces. Strictly prohibited from importing database connections, ORM schemas, or outbound adapters.
   - `src/adapters/outbound/`: Implements port interfaces defined in `src/core/ports/`. Strictly prohibited from defining business rules or orchestrating workflows.
   - `src/tools/`: Domain capability tools depend solely on `src/core/ports/` and `src/tools/BaseTool.ts`. Strictly prohibited from importing outbound adapters.
   - `src/index.ts`: The sole runtime composition root wiring adapters into use cases.
2. **The Inward Dependency Rule**: Source code dependencies must strictly flow inward toward the core.
3. **No Phantom Ports**: Any outbound capability required by the core or adapters must have a corresponding TypeScript interface in `src/core/ports/` committed before or atomically with the adapter implementation.
4. **No White-Box Test Exports**: Exports exist solely for production consumers. Functions or types must never be exported merely to satisfy a unit test.

---

## 3. Component Specifications

The Development Layer consists of 5 integrated components:

```
┌────────────────────────────────────────────────────────┐
│ 1. LLD Constitution (.agents/constitution.md)          │
│    10 Concrete Iny-Specific Rules with Hard Thresholds │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 2. Design Gate Skill (.agents/skills/design-gate/)     │
│    Mandatory Pre-Plan Artifact (docs/designs/*.md)     │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 3. Static Enforcement (Prettier, ESLint, Knip, Hooks)  │
│    Machine-Checked Linting, Formats, and Dead Code     │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 4. Code Reviewer Enhancement (code-reviewer.md)        │
│    P0/P1/P2 Constitution Compliance Review Gate        │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 5. Superpowers Skill Sync & Reference Catalogues       │
│    v6.4.1 Baseline + solid-skills / Slopnought Guides  │
└────────────────────────────────────────────────────────┘
```

---

### 3.1. Component 1: The LLD Constitution (`.agents/constitution.md`)

A single-page, binding rulebook loaded into the agent's context during design and review. It codifies 10 concrete rules, incorporating Slopnought anti-slop taxonomies and SOLID principles adapted for TypeScript Hexagonal Architecture.

#### The 10 Rules:

1. **Port-First Contract**: Every outbound capability (storage, network, LLM, time, logging) MUST have an interface in `src/core/ports/`. No adapter may be written without an explicit `implements Port` declaration.
2. **Inward Boundary Isolation**: Inbound adapters must never import outbound adapters or raw database clients (`PgDatabase`). They must communicate exclusively via core use cases or core ports.
3. **Tool Boundary Isolation**: Domain tools in `src/tools/` must never import outbound adapters. Formatting and presentation logic belong in presentation services or outbound adapters, not inside tool definitions.
4. **150-Line Source File Limit**: No production source file in `src/` may exceed 150 lines (excluding database table schemas in `schema.ts`). If a file approaches 130 lines, it must be evaluated for Single Responsibility decomposition.
5. **40-Line Function Limit**: No function or method may exceed 40 lines of code. Nested callbacks and transaction blocks count toward the parent function length.
6. **3-Level Nesting Limit**: Control flow nesting (`if`, `for`, `while`, `try`, callbacks) must not exceed a maximum depth of 3 levels. Early returns (`guard clauses`) must be used to flatten logic.
7. **No Test-Only Exports**: Every exported function, class, interface, and constant must have at least one production call site. Testing internals must be performed through the public interface of the module.
8. **Single Responsibility & Cohesion**: Entity files define data structures only (no utility logic). Time/timezone operations must use the centralized `src/core/utils/` or domain service, never ad-hoc date math.
9. **Zero Speculative Boilerplate**: Do not write factory classes, generic abstractions, uncalled helper functions, or polymorphic constructors for "future extensibility". If it is not consumed by the active feature, delete it.
10. **Strict Convention Conformance**:
    - Extensionless imports: All TypeScript imports must omit `.js` or `.ts` extensions.
    - Uniform Dependency Injection: All dependencies must be passed via constructor arguments. No optional chaining on required dependencies (`this.logger?.debug?.()`), no inline fallback stubs (`noopLogger`).
    - Exhaustive JSDoc: Every public class, method, interface, and port must feature standard JSDoc documenting parameters, return values, and failure contracts without em dashes.

---

### 3.2. Component 2: The Design Gate Skill (`.agents/skills/design-gate/`)

A new, mandatory superpower skill inserted into the project workflow **between Spec Approval and Implementation Plan Creation**.

#### Workflow Positioning:

```
[1. Brainstorming] ──▶ [2. Spec Creation] ──▶ [3. Spec Human Review Gate] (Hard Stop)
                                                               │
                                                               ▼ (Approved)
                                                      [4. DESIGN GATE] (NEW)
                                                               │
                                                               ▼
                                                  [5. Design Human Review Gate] (Hard Stop)
                                                               │
                                                               ▼ (Approved)
                                                      [6. Writing Plans]
                                                               │
                                                               ▼
                                                      [7. Worktree TDD Execution]
```

#### Deliverable: The Design Artifact

The agent must generate `docs/designs/YYYY-MM-DD-<topic>-design.md` containing:

1. **Module Map**:
   - Explicit table listing every file to create or modify.
   - Columns: `File Path`, `Zone` (`Core Entity`, `Core Port`, `Core Use-Case`, `Inbound Adapter`, `Outbound Adapter`, `Tool`), `Single Responsibility` (one sentence), `Does NOT Do` (explicit boundary constraint).
2. **Dependency Edge List / Mermaid Graph**:
   - Visual or list representation showing all import edges.
   - Verification that all edges point inward toward `src/core/`.
3. **Constitution Compliance Pre-Check**:
   - Line count projection (< 150 lines per file).
   - Function complexity projection (< 40 lines, < 3 depth).
   - Port existence confirmation for all outbound dependencies.
4. **Reference Pattern Alignment**:
   - Explicit citations to 2 existing canonical files in the repository that this implementation models.
5. **"Declined to Build" List**:
   - Explicit catalog of speculative abstractions, unused factories, or premature helpers considered but deliberately excluded.

#### Compaction & Session Safety:

- The design artifact is persisted on disk under `docs/designs/`.
- Implementation plans generated by `writing-plans` MUST include the path to the approved design artifact in their header (`Design: docs/designs/...`).
- Any task in an implementation plan that attempts to introduce a file, dependency edge, or export not present in the approved design artifact constitutes a plan validation failure.

---

### 3.3. Component 3: Static Enforcement Tooling

Machine-checked enforcement guaranteeing that unformatted, bloated, or cyclic code cannot be committed.

#### 1. Prettier (`.prettierrc`)

Enforces formatting standards across the entire repository:

```json
{
	"useTabs": true,
	"tabWidth": 2,
	"singleQuote": false,
	"semi": true,
	"trailingComma": "all",
	"printWidth": 100
}
```

#### 2. ESLint (Flat Config: `eslint.config.js`)

Configured with `@typescript-eslint` and `eslint-plugin-import`:

- `max-lines`: `["error", { "max": 150, "skipBlankLines": true, "skipComments": true }]` (applied to `src/**/*.ts`, overriding to 300 for `src/**/schema.ts` and `tests/**/*.ts`).
- `max-lines-per-function`: `["error", { "max": 40, "skipBlankLines": true, "skipComments": true }]` (excluding test files).
- `max-depth`: `["error", 3]`.
- `complexity`: `["error", 10]`.
- `no-else-return`: `["error", { "allowElseIf": false }]`.
- `@typescript-eslint/no-unused-vars`: `["error", { "argsIgnorePattern": "^_" }]`.
- `import/no-cycle`: `["error", { "maxDepth": Infinity }]`.
- `no-restricted-syntax`: Custom AST selector banning imports ending in `.js` or `.ts` in TypeScript files.

#### 3. Knip (`knip.json`)

Configured to detect dead code, unused files, and unconsumed exports:

```json
{
	"$schema": "https://unpkg.com/knip@5/schema.json",
	"entry": ["src/index.ts", "scripts/**/*.ts"],
	"project": ["src/**/*.ts"],
	"ignoreExportsUsedInFile": true
}
```

#### 4. Git Pre-Commit Hook (`.git/hooks/pre-commit`)

Executable shell hook executing staged validation:

1. Runs `npx prettier --check` on staged `.ts` files.
2. Runs `npx eslint` on staged `.ts` files.
3. Blocks the commit if any formatting or lint violation occurs.

#### 5. NPM Scripts (`package.json`)

- `"lint"`: `"eslint src tests"`
- `"lint:fix"`: `"eslint src tests --fix"`
- `"format"`: `"prettier --write ."`
- `"format:check"`: `"prettier --check ."`
- `"deadcode"`: `"knip"`
- `"check:all"`: `"npm run format:check && npm run lint && npm run deadcode && npm run typecheck && npm test"`

---

### 3.4. Component 4: Code Reviewer Enhancement (`code-reviewer.md`)

Enhances the existing Superpowers code reviewer subagent prompt (`.agents/skills/requesting-code-review/code-reviewer.md` and task review in SDD) with a dedicated **Constitution Compliance Audit**.

#### Severity Classification:

- **P0 (Blocking - Hard Failure)**:
  - Any violation of Constitution Rules 1, 2, 3 (architectural boundary breach, direct DB call in inbound adapter, missing port).
  - Any file exceeding 150 lines or function exceeding 40 lines.
  - Any export lacking a production consumer.
  - Presence of dead code or unconsumed factory classes.
  - Action: Immediate implementation fix required. Cannot merge.
- **P1 (Important - Blocking unless explicitly overridden)**:
  - Inconsistent import conventions (`.js` extensions).
  - Missing JSDoc on public interfaces/methods.
  - Overly defensive coding (`?.` chaining on injected dependencies).
  - Nesting depth violations (> 3 levels).
- **P2 (Minor / Informational)**:
  - Local variable naming improvements.
  - Micro-optimizations.

---

### 3.5. Component 5: Superpowers Skill Sync & Reference Catalogues

#### 1. Upstream Skill Synchronization

Synchronize project-local `.agents/skills/` with the global Superpowers v6.4.1 installation at `/home/pujan/.gemini/config/plugins/superpowers/`:

- Update `executing-plans` from legacy 50-line stub to the full 374-line system with `.superpowers/sdd/` ledgers and pre-flight scans.
- Sync `brainstorming` (including `Establish Shared Understanding` and refined `<HARD-GATE>`).
- Sync `test-driven-development` with the mandatory whole-suite test run requirement.
- Sync `writing-plans` with the mandatory `Review Focus` section.
- Sync `requesting-code-review` with the "Declined to judge" requirement.

#### 2. Curated Reference Integration

Import battle-tested catalogues from `solid-skills` into `.agents/references/`:

- `.agents/references/code-smells.md`: Anti-pattern taxonomy covering primitive obsession, feature envy, shotgun surgery, and data clumps.
- `.agents/references/object-design.md`: Responsibilities, stereotypes, and interface cohesion.
- `.agents/references/solid-principles.md`: Practical TypeScript examples of Single Responsibility, Open-Closed, Liskov Substitution, Interface Segregation, and Dependency Inversion.

---

## 4. Remediation & Codebase Alignment Strategy

To achieve a 100% compliant codebase, remediation will proceed in three controlled phases:

### Phase 1: Tooling & Governance Foundation

1. Install and configure Prettier, ESLint, and Knip.
2. Commit `.agents/constitution.md`, `.agents/skills/design-gate/`, and `.agents/references/`.
3. Sync `.agents/skills/` with upstream Superpowers v6.4.1.
4. Install `.git/hooks/pre-commit`.
5. Run Prettier format repo-wide (`npm run format`) in an isolated commit.

### Phase 2: Core & Established Adapters Remediation

1. Clean `src/core/use-cases/AgentLoop.ts`:
   - Extract IST time utilities into `src/core/utils/Temporal.ts` (or domain service).
   - Remove internal exports (`ToolExecutionOutcome`, `formatMessageTimeIST`, etc.); test behavior through `AgentLoop.run()`.
   - Restore `AgentLoop` to its pure ReAct coordination responsibility (< 150 lines).
2. Clean `src/tools/`:
   - Remove raw schema exports in `DisplayMessCardTool.ts` and `QueryMessDetailsTool.ts`.
   - Remove direct import of `MessCardRenderer` from `DisplayMessCardTool.ts`.

### Phase 3: Mess Subsystem Architectural Realignment

1. **Create Missing Core Port**: Introduce `src/core/ports/MessStagingRepositoryPort.ts` defining staging and commit contracts.
2. **Decouple Inbound Driving Adapters**:
   - Refactor `FoodAnnouncementsInboundAdapter.ts`: Remove direct `db: PgDatabase` injection. Inject `MessStagingRepositoryPort` or a dedicated use case.
   - Refactor `TriageCliController.ts`: Depend on `MessStagingRepositoryPort`, not `PostgresMessStagingRepository`.
3. **Decompose God Classes**:
   - Decompose `PostgresMessStagingRepository.ts` (658 lines) into lean coordinator + specialized modules (e.g. `PostgresStagingQueue`, `PostgresMealCommitTransaction`, `PostgresMealRollback`).
   - Decompose `TriageTerminalView.ts` (652 lines) into focused sub-renderers.
4. **Purge Speculative & Dead Code**:
   - Remove uncalled `MessMealFactory.ts` or wire it to real repository call sites.
   - Unify scattered IST time math to a single utility.
   - Eliminate all `.js` import extensions across all 38+ files.
   - Remove unused `messStagingRepository` instantiation in `src/index.ts`.

---

## 5. Success Metrics

1. **Zero Halting Refactor PRs**: Feature PRs complete without requiring subsequent emergency refactor branches to restore code comprehension.
2. **Complete Comprehension Ceiling**: The human owner can open any file in `src/` and fully understand its responsibility, boundaries, and dependencies in under 2 minutes.
3. **Zero Lint & Formatting Errors**: `npm run check:all` executes with 0 warnings and 0 errors across compiler, linter, formatter, dead code detector, and test suite.
4. **100% Port Coverage**: Zero outbound adapters exist without a corresponding `src/core/ports/` interface.
5. **Zero Upstream Boundary Breaches**: Zero inbound adapters or tools import outbound adapters or database drivers.

---

## 6. Rejected Alternatives

1. **Standalone `solid-skills` Installation**:
   - _Rejected because_: Imposes dogmatic limits (< 10 line methods, mandatory Value Objects for all primitives) that promote extreme file fragmentation and shallow modules. Also collides with Superpowers' plan execution and TDD workflows.
   - _Adopted instead_: Synthesizing its best reference catalogues into `.agents/references/` and the Design Gate.
2. **Standalone `Slopnought` Skill**:
   - _Rejected because_: Lacks Hexagonal architecture awareness and operates generically across all frameworks.
   - _Adopted instead_: Ingesting its anti-slop rules directly into the binding Constitution.
3. **Post-Implementation Refactor Phase**:
   - _Rejected because_: Post-hoc refactoring treats symptoms rather than root causes. Agents perform cosmetic renames when structural flaws are already baked into the plan.
   - _Adopted instead_: Shifting governance upstream to the Design Gate (between Spec and Plan).
4. **`dependency-cruiser` Rule Engine**:
   - _Rejected because_: Adds significant configuration maintenance overhead for a 42-to-60 file repository.
   - _Adopted instead_: ESLint AST rules + Design Gate module map verification + Knip.
