# Logging Subsystem Design Specification

## 1. Overview
This document specifies the design for the **Logging Subsystem** in Iny. In accordance with Hexagonal Architecture, the logging subsystem introduces a pure domain port (`LoggerPort`) that elevates errors to first-class citizens via method overloading, accompanied by a high-performance driven adapter (`PinoLoggerAdapter`) backed by `pino`. In development, human-readable colorized formatting is achieved via UNIX piping with `pino-pretty` as a dev dependency, keeping runtime production artifacts lean and free from extra worker threads.

## 2. Architecture & File Structure

```text
src/
├── adapters/
│   └── driven/
│       ├── logger/
│       │   └── PinoLoggerAdapter.ts       # Implements LoggerPort using pino
│       ├── llm/
│       │   └── DeepseekAdapter.ts         # Receives optional LoggerPort via DI
│       └── plugin-registry/
│           └── InMemoryPluginRegistry.ts  # Receives optional LoggerPort via DI
├── core/
│   ├── ports/
│   │   └── LoggerPort.ts                  # Pure domain interface
│   └── use-cases/
│       └── ProcessIncomingMessage.ts      # Receives LoggerPort via DI
├── config.ts                              # Validates LOG_LEVEL via Zod
└── index.ts                               # Composition root (wires logger into app)
```

## 3. Interfaces & Contracts

### 3.1. `LoggerPort` (`src/core/ports/LoggerPort.ts`)
```typescript
export type LogContext = Record<string, unknown>;

export interface LoggerPort {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;

  // Error overloads: Treating Error as a first-class citizen
  error(message: string, error: unknown, context?: LogContext): void;
  error(message: string, context?: LogContext): void;

  // Fatal overloads: Unrecoverable failures terminating the process
  fatal(message: string, error: unknown, context?: LogContext): void;
  fatal(message: string, context?: LogContext): void;

  // Child logger: Scoped context inheritance (e.g. userId, messageId, component)
  child(bindings: LogContext): LoggerPort;
}
```

## 4. Component Details

### 4.1. `PinoLoggerAdapter` (`src/adapters/driven/logger/PinoLoggerAdapter.ts`)
- **Engine:** Built on `pino`.
- **Constructor:**
  ```typescript
  constructor(level: string = 'info', baseLogger?: pino.Logger)
  ```
- **Argument Mapping:**
- `debug`, `info`, `warn`: Maps each method's `(message, context)` to its corresponding Pino level with context first (for example, `this.pino.debug(context ?? {}, message)`).
  - `error`, `fatal`:
    - Handles method overloads cleanly:
      - If 2nd argument is an `Error` (or 3rd argument is provided as context), serializes as `this.pino.error({ err: errorArg, ...contextArg }, message)`.
      - If 2nd argument is a plain context object (and 3rd argument is omitted), serializes as `this.pino.error(contextArg, message)`.
      - If 2nd argument is omitted, serializes as `this.pino.error(message)`.
  - `child(bindings)`: Returns a new `PinoLoggerAdapter` wrapping `this.pino.child(bindings)`.

### 4.2. Configuration (`src/config.ts`)
- Extends the Zod schema to include:
  ```typescript
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info')
  ```

### 4.3. Pipeline & Dependencies (`package.json`)
- **Runtime Dependency:** `pino` (`dependencies`).
- **Development Dependency:** `pino-pretty` (`devDependencies`).
- **Scripts:**
  - `"dev": "tsx --env-file=.env src/index.ts | pino-pretty"`
  - `"start": "node --env-file=.env dist/index.js"`
  - `pino-pretty` is omitted entirely in production installations (`npm ci --omit=dev`), ensuring zero runtime bloat.

## 5. Codebase Integration

### 5.1. `ProcessIncomingMessage`
- Injects `logger: LoggerPort` into its constructor:
  ```typescript
  constructor(
    private sender: MessageSenderPort,
    private llm: LLMPort,
    private registry: PluginRegistryPort,
    private logger: LoggerPort
  ) {}
  ```
- On message execution:
  - Spawns a child logger with contextual bindings:
    `const log = this.logger.child({ userId: message.userId, messageId: message.id });`
  - Logs message ingestion: `log.info('Processing incoming message');`
  - Logs available tools: `log.debug('Available tools discovered', { count: plugins.length });`
  - Logs tool execution: `log.info('Executing tool call', { toolName: response.toolCall.name });`
  - Logs successful completion: `log.info('Message processed successfully');`
  - Logs error on failure: `log.error('Failed to process message', error);`

### 5.2. Driven Adapters (`DeepseekAdapter`, `InMemoryPluginRegistry`, `CLIAdapter`)
- Accept an optional `logger?: LoggerPort` in their constructors:
  - `DeepseekAdapter`: Logs outgoing LLM requests and response tokens/tool calls at `debug` level.
  - `InMemoryPluginRegistry`: Logs tool registrations and execution errors.
  - `CLIAdapter`: Logs start/stop CLI session events.

### 5.3. Application Composition Root (`src/index.ts`)
- Instantiates root logger:
  ```typescript
  const logger = new PinoLoggerAdapter(config.LOG_LEVEL);
  ```
- Passes `logger` into `ProcessIncomingMessage` and adapters.
- Logs application startup:
  ```typescript
  logger.info('Iny application started');
  ```

## 6. Testing Strategy

### 6.1. Unit Tests for `PinoLoggerAdapter`
- **File:** `tests/adapters/driven/logger/PinoLoggerAdapter.test.ts`
- **Test cases:**
  - Emits logs at correct levels (`debug`, `info`, `warn`, `error`, `fatal`).
  - Serializes `Error` instances cleanly including message and stack trace under `err`.
  - Serializes metadata context correctly when no `Error` is passed to `error()` / `fatal()`.
  - Retains child bindings across subsequent log calls.
  - Filters out log entries below the configured `LOG_LEVEL`.

### 6.2. Mock Logger for Unit Tests
- In test suites for use cases and adapters (e.g. `ProcessIncomingMessage.test.ts`), provide a silent `mockLogger`:
  ```typescript
  const mockLogger: LoggerPort = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  ```
  This keeps all test output completely clean and pristine while allowing explicit assertions on logger behavior.
