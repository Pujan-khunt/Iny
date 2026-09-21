# Feature Specifications (Specs)

This directory houses domain logic, API contracts, requirements, and edge case specifications for Iny features.

## Directory Structure

- `docs/specs/`: In-flight, active feature specifications currently being implemented.
- `docs/specs/archive/`: Historical specifications preserved for domain context.

## Lifecycle & Rules

1. **Active Specs**: During feature development, specifications live in `docs/specs/` (named `YYYY-MM-DD-<topic>-spec.md` or `YYYY-MM-DD-<topic>-design.md`).
2. **Atomic Within-PR Archival**: When implementation and verification are complete, the active spec is moved from `docs/specs/` to `docs/specs/archive/` within the same feature branch and pull request right before merging. This guarantees that `main` never contains stale or unfinished active specs.
3. **Precedence**: Archived specifications represent point-in-time snapshots and design records. If any archived specification conflicts with `docs/ARCHITECTURE.md` or the active codebase, `docs/ARCHITECTURE.md` and the active codebase take precedence.
