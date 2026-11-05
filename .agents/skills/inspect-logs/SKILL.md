---
name: inspect-logs
description: Use to inspect, tail, and diagnose application runtime logs from development sessions without manual user proxying.
---

# Inspect Application Logs

Use this skill when investigating runtime errors, inspecting webhook delivery, diagnosing dialogue pipeline failures, tracing food menu ingestion events, or checking live operational behavior.

## Standard Runbook

### 1. Triage Errors First

Whenever investigating an unexpected failure, check for exceptions and error stack traces first:

```bash
npx tsx scripts/inspect-logs.ts --errors-only -n 15
```

### 2. Inspect Recent Operational Context

To inspect recent normal application events (e.g. inbound messages, adapter calls, database queries):

```bash
npx tsx scripts/inspect-logs.ts -n 30 --since 15m
```

### 3. Filter by User JID, WhatsApp Group, or Component

To trace events related to a specific WhatsApp sender, group, or component:

```bash
npx tsx scripts/inspect-logs.ts --grep <identifier-or-keyword> -n 25
```

### 4. Inspect a Specific Session Log File

To list available session log files:

```bash
npx tsx scripts/inspect-logs.ts --list
```

To query a specific historical log file:

```bash
npx tsx scripts/inspect-logs.ts --file logs/app-YYYY-MM-DDTHH-mm-ss.log -n 50
```

### 5. Follow in Real Time (Background Monitoring)

When running an automated test or awaiting external WhatsApp events, follow the log stream in real time:

```bash
npx tsx scripts/inspect-logs.ts --follow --level warn
```

## Agent Guardrails

- **Context Window Conservation:** Never run unbounded log dumps. Always specify `-n` (10 to 50 entries) or a narrow `--since` window (e.g. `5m` or `15m`).
- **Targeted Grep:** Use `--grep` to isolate relevant turn IDs or JIDs rather than reading through unrelated background events.
- **Root Cause Evidence:** For runtime exceptions, inspect the formatted stack trace and `context` fields to identify the exact failing line and inputs before attempting code modifications.
