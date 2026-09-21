# Agent Guidelines & Zero-Trust Operating Contract

## 1. Zero-Trust Principle
No agent working in this repository may rely on tribal knowledge, make assumptions about unstated requirements, or invent architectural conventions. Every structural decision, dependency choice, and interface boundary must follow the documented architecture.

## 2. Documentation Hierarchy
Before proposing or implementing any changes, agents must consult the documentation in this order:
1. **System Architecture (`docs/ARCHITECTURE.md`)**: The map of the codebase, Hexagonal boundaries, ports, adapters, and flow of control.
2. **Feature Specifications (`docs/specs/`)**: Active business logic and API contracts for features in progress.
   - Note: `docs/specs/archive/` contains completed historical blueprints. Archived specs never override the active codebase.
3. **Implementation Plans (`docs/plans/`)**: Ephemeral step-by-step TDD execution plans (gitignored).

## 3. Mandatory 5-Step Workflow
Every task (new feature, subsystem modification, or structural refactor) must follow this lifecycle:
1. **Brainstorming Session**: Discuss user intent, scope, and technical trade-offs collaboratively with the user.
2. **Spec Creation**: Draft `docs/specs/YYYY-MM-DD-<topic>-spec.md` focusing strictly on requirements, domain logic, edge cases, and API contracts.
3. **Human Review Gate (Hard Stop)**:
   - Submit the spec to the user for explicit review and approval.
   - Hard Gate: No implementation plan may be drafted until the user explicitly approves the spec.
4. **Implementation Plan**:
   - Draft step-by-step TDD plan in `docs/plans/YYYY-MM-DD-<topic>-plan.md`.
5. **Worktree Execution & Atomic Archival**:
   - Create an isolated git worktree under `.worktrees/<branch>`.
   - Execute the plan with strict Red-Green-Refactor TDD.
   - **Atomic Archival**: Right before PR completion/merge, move the spec from `docs/specs/` to `docs/specs/archive/` within the same branch.

## 4. Architectural Invariants
- **Hexagonal Purity**: `src/core/` must have **zero** external runtime dependencies. Core entities, use cases, and ports are 100% pure TypeScript.
- **Directional Adapters**: Inbound drivers live in `src/adapters/inbound/`. Outbound gateways implementing core ports live in `src/adapters/outbound/`.
- **Composition Root**: In production runtime code, only `src/index.ts` is permitted to wire and inject root adapters into use cases (unit tests and internal adapter factory methods like `PinoLoggerAdapter.child()` may instantiate adapters directly).

## 5. Git Commits
Whenever you create a git commit, you MUST follow the Conventional Commits format and you MUST include a body explaining the changes.

**Format:**
<type>[optional scope]: <description>

[optional body]

**Rules:**
1. **Type:** Must be `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, or `revert`.
2. **Subject line:** Use the imperative, present tense ("add feature", not "added feature"). Do not capitalize the first letter. No dot (.) at the end.
3. **Body:** A body is REQUIRED. It should include the motivation for the change and contrast this with previous behavior. Wrap text at 72 characters.
4. **When to commit:** Do NOT automatically commit changes. You must wait for EXPLICIT approval or instruction from the user before creating any git commits.
5. **Branching policy:** Never commit directly to `main`. All work must be conducted on feature branches or isolated worktrees and integrated via pull requests.
