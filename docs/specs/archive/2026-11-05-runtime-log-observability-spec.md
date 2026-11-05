# Runtime Log Observability Specification

Date: 2026-11-05

**Status:** COMPLETED on 2026-11-05

## 1. Outcome and Scope

Provide autonomous AI agents (such as Antigravity CLI) and developers with structured, low-friction access to application runtime logs during local development and testing, eliminating the need for manual copy-pasting or interactive terminal proxying.

The scope encompasses:

1. **Application Multistream Logging:** Configuring Pino in the application to stream formatted, colored logs to standard output for the developer in development mode, while simultaneously streaming structured, ANSI-free, newline-delimited JSON (NDJSON) to disk.
2. **Session-Stamped Log Lifecycle:** Generating unique, timestamped log files per application boot/session in a gitignored `logs/` directory, maintaining a `logs/latest.log` symlink (with fallback discovery) pointing to the current active session.
3. **Structured Log Query Tool:** Delivering an executable script (`scripts/inspect-logs.ts`) that allows agents and developers to surgically filter, tail, grep, follow in real time, and inspect logs by level, time window, component context, and error stacks without saturating LLM context windows.
4. **Agent Skill:** Providing a dedicated Antigravity skill (`.agents/skills/inspect-logs/SKILL.md`) that documents when and how the agent should inspect logs to diagnose errors, trace incoming WhatsApp events, and verify autonomous flows.

This specification focuses strictly on requirements, domain logic, edge cases, and observable contracts. Module maps, TypeScript interfaces, and implementation plans follow explicit user approval of this specification in accordance with `AGENTS.md`.

---

## 2. Agreed Requirements and Proposed Defaults

### Agreed During Brainstorming & Review

- **Internal Multistreaming:** Pino handles dual streaming internally within the Node process rather than relying on shell pipe redirection in `package.json` scripts.
- **Production Hygiene:** `pino-pretty` is strictly a development dependency. In production (`NODE_ENV === "production"`), the application outputs pure NDJSON to stdout without importing `pino-pretty`. In development (`NODE_ENV === "development"` or `LOG_PRETTY_CONSOLE === true`), `pino-pretty` is loaded dynamically to format stdout.
- **Session-Stamped Files:** Every application boot creates a unique timestamped log file.
- **7-Day Retention Window:** Files in `logs/` older than 7 days (7 * 24 hours) are automatically pruned on startup. Users may also remove log files manually using standard filesystem commands (`rm`).
- **Resilient Discovery:** `scripts/inspect-logs.ts` defaults to `logs/latest.log`, but automatically falls back to finding the newest `logs/app-*.log` file by mtime/timestamp if the symlink is missing or broken.
- **Real-Time Follow Support:** The inspection script supports a `--follow` mode (like `tail -f`) to enable background monitoring by agents and developers.
- **Dedicated Agent Skill:** A skill under `.agents/skills/` will guide agent usage of the log inspection tool.

### Proposed Configuration Defaults

- **Log Directory:** `logs/` at the workspace root, excluded from git via `.gitignore`.
- **File Naming Convention:** `logs/app-YYYY-MM-DDTHH-mm-ss.log` (e.g. `logs/app-2026-11-05T18-45-00.log`).
- **Active Symlink:** `logs/latest.log` pointing to the active session log file.
- **Environment Configuration:**
  - `LOG_TO_FILE` (boolean, default: `true` in development, `false` in test unless explicitly enabled).
  - `LOG_DIR` (string, default: `logs`).
  - `LOG_RETENTION_DAYS` (number, default: `7`).
  - `LOG_PRETTY_CONSOLE` (boolean, default: `true` in development, `false` in production).

---

## 3. Log Generation and Dual-Streaming Contracts

### 3.1 Terminal Output Stream

- In development mode, stdout is formatted with `pino-pretty` for human readability.
- In production mode (`NODE_ENV=production`), stdout receives raw NDJSON directly.
- Must not block or crash the process if the terminal is detached or stdout is closed.

### 3.2 File Output Stream

- Pure newline-delimited JSON (NDJSON).
- Completely free of ANSI escape sequences or color codes.
- Every line is a valid JSON object containing at minimum:
  - `level`: Integer or string log level conforming to Pino standards (`10: trace`, `20: debug`, `30: info`, `40: warn`, `50: error`, `60: fatal`).
  - `time`: Epoch millisecond timestamp.
  - `msg`: String log message.
  - `context`: Structured log context objects (e.g. `jid`, `turnId`, `handler`, `action`).
  - `err` / `error`: Serialized Error object with `message`, `type`, `stack`, and optional causes.
- Streams must flush synchronously or on process termination (`SIGINT`, `SIGTERM`, `beforeExit`) to avoid losing the final error lines of a crashing process.

### 3.3 Hexagonal Invariant

- Core interfaces in `src/core/ports/LoggerPort.ts` must remain pure TypeScript with zero external runtime dependencies.
- Multistreaming, file handle management, and dynamic `pino-pretty` loading reside strictly in `src/adapters/outbound/logger/PinoLoggerAdapter.ts` and runtime wiring in `src/index.ts`.

---

## 4. Log Inspection Tool Contract (`scripts/inspect-logs.ts`)

The inspection script must be runnable via `npx tsx scripts/inspect-logs.ts [options]`.

### 4.1 CLI Arguments and Flags

| Flag            | Short | Type    | Default           | Description                                                               |
| --------------- | ----- | ------- | ----------------- | ------------------------------------------------------------------------- |
| `--file`        | `-f`  | string  | `logs/latest.log` | Path to log file to inspect (falls back to newest `app-*.log` if missing) |
| `--tail`        | `-n`  | number  | `30`              | Return the latest N matched entries                                       |
| `--level`       | `-l`  | string  | `debug`           | Minimum log level (`debug`, `info`, `warn`, `error`, `fatal`)             |
| `--since`       | `-s`  | string  | none              | Time window filter (e.g. `5m`, `15m`, `1h`, `24h`, or ISO-8601 string)    |
| `--grep`        | `-g`  | string  | none              | Substring or regex filter on message or JSON values                       |
| `--errors-only` | `-e`  | boolean | `false`           | Filter only entries containing `err` or `error` payloads                  |
| `--follow`      | `-w`  | boolean | `false`           | Follow new log entries in real time (like `tail -f`) until interrupted    |
| `--raw`         | `-r`  | boolean | `false`           | Output matched raw NDJSON lines instead of formatted summary              |
| `--list`        | none  | boolean | `false`           | List available session log files with sizes and timestamps                |

### 4.2 Output Formatting Contract for LLM Agents

When `--raw` is false:

- Lines are formatted concisely: `[ISO_TIMESTAMP] [LEVEL] message {key: value}`.
- For errors, format:
  ```
  [ISO_TIMESTAMP] [ERROR] message
    Type: <ErrorType>
    Error: <ErrorMessage>
    Stack:
      at <trace_line_1>
      at <trace_line_2>
  ```
- If no logs match the criteria, print a deterministic notice: `No log entries found matching criteria.`
- The script must return exit code `0` on successful query (even if 0 records match), and non-zero on file access errors or invalid arguments.

---

## 5. Agent Skill Contract (`.agents/skills/inspect-logs/SKILL.md`)

The skill informs Antigravity how to triage application logs autonomously:

- **Triggers:** Agent investigating errors, unexpected behavior, failed webhook handling, food menu ingestion anomalies, or user requests like "why did the bot fail?" or "check recent logs".
- **Standard Runbook:**
  1. Inspect error entries first: `npx tsx scripts/inspect-logs.ts --errors-only -n 10`.
  2. If looking for recent conversational context: `npx tsx scripts/inspect-logs.ts -n 30 --since 15m`.
  3. If tracking a specific user or group JID: `npx tsx scripts/inspect-logs.ts --grep <jid> -n 25`.
  4. If monitoring during a test or live operation: Launch background task with `npx tsx scripts/inspect-logs.ts --follow --level warn`.
- **Guardrails for Agent:** Enforce small `-n` bounds (10 to 50) to prevent saturating model context tokens.

---

## 6. Edge Cases & Resilience Guardrails

1. **Missing `logs/` directory:** Automatically create the directory recursively before creating write streams.
2. **Missing `logs/latest.log`:** If `logs/latest.log` does not exist or is broken, `scripts/inspect-logs.ts` automatically discovers the newest `logs/app-*.log` file in `logs/` by mtime/timestamp.
3. **Corrupted NDJSON Lines:** If a process crashes mid-write, partial lines must not break the parser; corrupted lines must be skipped with a non-fatal warning to `stderr`.
4. **Log Retention & Purging:** Files in `logs/` older than 7 days are pruned during startup; any failure during pruning (e.g. file lock or permissions) logs a warning and does not abort application startup.
5. **High-Frequency Logging:** Asynchronous non-blocking file streaming via Node streams so heavy logging does not degrade event-loop latency.

---

## 7. Acceptance Criteria

1. Running the application (`npm run dev`) creates a timestamped file `logs/app-YYYY-MM-DDTHH-mm-ss.log` and updates `logs/latest.log`.
2. Developer console displays readable colored output via dynamically loaded `pino-pretty` in development, while production runs without `pino-pretty` imports.
3. File output contains raw, ANSI-free valid JSON on every line.
4. Old log files (>7 days) are automatically pruned on boot.
5. `scripts/inspect-logs.ts` successfully queries, filters by level, tails, filters by error, searches by regex, and follows live updates.
6. All existing project unit, integration, and architecture tests continue to pass (zero regressions).
7. `.agents/skills/inspect-logs/SKILL.md` passes validation and is discoverable by Antigravity CLI.
