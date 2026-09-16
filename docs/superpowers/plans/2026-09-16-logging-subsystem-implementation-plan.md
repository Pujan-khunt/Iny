# Logging Subsystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a production-grade structured logging subsystem for Iny based on Hexagonal Architecture, with a domain port (`LoggerPort`) supporting method overloading for first-class errors, a driven adapter (`PinoLoggerAdapter`) backed by `pino`, Zod log level validation, and dev-time colorized output via `pino-pretty`.

**Architecture:** A pure domain port (`LoggerPort`) and context type (`LogContext`) are introduced into `src/core/ports/`. The driven adapter `PinoLoggerAdapter` wraps `pino` to format and emit NDJSON logs to standard output. `ProcessIncomingMessage` receives the logger via constructor dependency injection and creates scoped child loggers per message. Secondary adapters (`DeepseekAdapter`, `InMemoryPluginRegistry`, `CLIAdapter`) accept an optional logger instance. `src/index.ts` acts as the composition root wiring the logger into the system, and `package.json` pipes output to `pino-pretty` in development.

**Tech Stack:** Node.js v22+, TypeScript, Pino, pino-pretty, Zod, Vitest.

**Spec:** docs/superpowers/specs/2026-09-15-logging-subsystem-design.md

## Global Constraints

- Runtime environment is Node.js v22+ with native `--env-file=.env` support.
- Strict TypeScript (`"strict": true` in `tsconfig.json`).
- Zero external dependencies in `src/core/` (pure TypeScript only).
- Production runtime dependencies must only include `pino`; `pino-pretty` must be a `devDependency`.
- All tests must pass with pristine output (no unhandled errors or noise).
- Every git commit must follow the Conventional Commits specification with a descriptive body wrapped at 72 characters explaining motivation and contrast.
- Wait for explicit user approval before making git commits.

---

### Task 1: Package Dependencies and Configuration Schema

**Files:**
- Modify: `package.json`
- Modify: `src/config.ts`
- Modify: `.gitignore`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: `process.env.LOG_LEVEL`
- Produces: `config.LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error' | 'fatal'`

- [ ] **Step 1: Write the failing tests for `LOG_LEVEL` configuration**

Update `tests/config.test.ts` to add test cases verifying `LOG_LEVEL` defaults to `'info'`, accepts valid levels, and rejects invalid levels:

```typescript
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

describe('Config', () => {
  const initialEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...initialEnv };
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    process.env = initialEnv;
  });

  it('should throw if DEEPSEEK_API_KEY is missing', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    await expect(import('../src/config')).rejects.toThrow();
  });

  it('should throw if DEEPSEEK_API_KEY is empty', async () => {
    process.env.DEEPSEEK_API_KEY = '';
    await expect(import('../src/config')).rejects.toThrow();
  });

  it('should export config if DEEPSEEK_API_KEY is present with default LOG_LEVEL info', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    delete process.env.LOG_LEVEL;
    const { config } = await import('../src/config');
    expect(config.DEEPSEEK_API_KEY).toBe('test_key');
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('should accept valid LOG_LEVEL values', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.LOG_LEVEL = 'debug';
    const { config } = await import('../src/config');
    expect(config.LOG_LEVEL).toBe('debug');
  });

  it('should throw if LOG_LEVEL is invalid', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    process.env.LOG_LEVEL = 'verbose';
    await expect(import('../src/config')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL (AssertionError: expected undefined to be 'info' or missing property).

- [ ] **Step 3: Install dependencies and update `package.json`, `src/config.ts`, and `.gitignore`**

Run installation commands:
```bash
npm install pino
npm install -D pino-pretty
```

Update `"dev"` script in `package.json` to pipe output into `pino-pretty`:
```json
    "dev": "tsx --env-file=.env src/index.ts | pino-pretty",
```

Update `src/config.ts` to include `LOG_LEVEL` validation:
```typescript
import { z } from 'zod';

const envSchema = z.object({
  DEEPSEEK_API_KEY: z.string().min(1, 'DEEPSEEK_API_KEY is required'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:\n' + z.prettifyError(parsedEnv.error));
  throw new Error('Invalid environment variables');
}

export const config = parsedEnv.data;
```

Update `.gitignore` to ignore the Vitest cache directory:
```gitignore
.worktrees/
node_modules/
dist/
.env
.vitest/
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (all 5 tests pass).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/config.ts tests/config.test.ts .gitignore
git commit -m "feat(config): add LOG_LEVEL validation, pino dependencies, and ignore .vitest

Add pino runtime dependency and pino-pretty dev dependency. Update
package.json dev script to pipe output to pino-pretty. Extend Zod
environment schema to validate LOG_LEVEL enum with default 'info'.
Add .vitest cache directory to .gitignore."
```

---

### Task 2: Core Domain Port (`LoggerPort`) and Driven Adapter (`PinoLoggerAdapter`)

**Files:**
- Create: `src/core/ports/LoggerPort.ts`
- Create: `src/adapters/driven/logger/PinoLoggerAdapter.ts`
- Test: `tests/adapters/driven/logger/PinoLoggerAdapter.test.ts`

**Interfaces:**
- Consumes: `pino`
- Produces: `LoggerPort`, `LogContext`, `PinoLoggerAdapter`

- [ ] **Step 1: Write the failing tests for `PinoLoggerAdapter`**

Create `tests/adapters/driven/logger/PinoLoggerAdapter.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { Writable } from 'node:stream';
import { PinoLoggerAdapter } from '../../../../src/adapters/driven/logger/PinoLoggerAdapter';

describe('PinoLoggerAdapter', () => {
  let logs: Record<string, unknown>[];
  let adapter: PinoLoggerAdapter;

  const setupLogger = (level: string = 'debug') => {
    logs = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        logs.push(JSON.parse(chunk.toString()));
        callback();
      },
    });
    const basePino = pino({ level }, stream);
    adapter = new PinoLoggerAdapter(level, basePino);
  };

  beforeEach(() => {
    setupLogger('debug');
  });

  it('should emit info logs with message and context', () => {
    adapter.info('User connected', { userId: 'u123' });

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(30); // pino info level
    expect(logs[0].msg).toBe('User connected');
    expect(logs[0].userId).toBe('u123');
  });

  it('should emit debug and warn logs', () => {
    adapter.debug('Debugging detail', { step: 1 });
    adapter.warn('Warning detail', { reason: 'slow' });

    expect(logs).toHaveLength(2);
    expect(logs[0].level).toBe(20); // debug
    expect(logs[0].msg).toBe('Debugging detail');
    expect(logs[0].step).toBe(1);
    expect(logs[1].level).toBe(40); // warn
    expect(logs[1].msg).toBe('Warning detail');
    expect(logs[1].reason).toBe('slow');
  });

  it('should filter logs below configured log level', () => {
    setupLogger('info');

    adapter.debug('This should be ignored');
    adapter.info('This should be logged');

    expect(logs).toHaveLength(1);
    expect(logs[0].msg).toBe('This should be logged');
  });

  it('should handle error overload with Error object and context', () => {
    const testError = new Error('Database connection failed');

    adapter.error('Operation failed', testError, { attempt: 3 });

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(50); // error
    expect(logs[0].msg).toBe('Operation failed');
    expect(logs[0].attempt).toBe(3);
    expect(logs[0].err).toBeDefined();
    const err = logs[0].err as Record<string, unknown>;
    expect(err.message).toBe('Database connection failed');
    expect(err.stack).toBeDefined();
  });

  it('should handle error overload with only Error object', () => {
    const testError = new Error('Network timeout');

    adapter.error('Request failed', testError);

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(50);
    expect(logs[0].msg).toBe('Request failed');
    expect(logs[0].err).toBeDefined();
    const err = logs[0].err as Record<string, unknown>;
    expect(err.message).toBe('Network timeout');
  });

  it('should handle error overload with plain context object (no Error)', () => {
    adapter.error('Request rejected', { statusCode: 403 });

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(50);
    expect(logs[0].msg).toBe('Request rejected');
    expect(logs[0].statusCode).toBe(403);
    expect(logs[0].err).toBeUndefined();
  });

  it('should handle error overload with only message', () => {
    adapter.error('Simple error occurred');

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(50);
    expect(logs[0].msg).toBe('Simple error occurred');
    expect(logs[0].err).toBeUndefined();
  });

  it('should handle fatal overload with Error object and context', () => {
    const fatalError = new Error('Out of memory');

    adapter.fatal('Process crashing', fatalError, { exitCode: 1 });

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(60); // fatal
    expect(logs[0].msg).toBe('Process crashing');
    expect(logs[0].exitCode).toBe(1);
    expect(logs[0].err).toBeDefined();
  });

  it('should handle fatal overload with plain context object (no Error)', () => {
    adapter.fatal('Unrecoverable state', { subsystem: 'database' });

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(60);
    expect(logs[0].msg).toBe('Unrecoverable state');
    expect(logs[0].subsystem).toBe('database');
    expect(logs[0].err).toBeUndefined();
  });

  it('should handle child loggers with propagated bindings', () => {
    const childLogger = adapter.child({ correlationId: 'corr-999' });
    childLogger.info('Child event', { extra: 'data' });

    expect(logs).toHaveLength(1);
    expect(logs[0].msg).toBe('Child event');
    expect(logs[0].correlationId).toBe('corr-999');
    expect(logs[0].extra).toBe('data');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/driven/logger/PinoLoggerAdapter.test.ts`
Expected: FAIL (Cannot find module `PinoLoggerAdapter`).

- [ ] **Step 3: Implement `LoggerPort` and `PinoLoggerAdapter`**

Create `src/core/ports/LoggerPort.ts`:
```typescript
export type LogContext = Record<string, unknown>;

export interface LoggerPort {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;

  error(message: string, error: unknown, context?: LogContext): void;
  error(message: string, context?: LogContext): void;

  fatal(message: string, error: unknown, context?: LogContext): void;
  fatal(message: string, context?: LogContext): void;

  child(bindings: LogContext): LoggerPort;
}
```

Create `src/adapters/driven/logger/PinoLoggerAdapter.ts`:
```typescript
import pino from 'pino';
import { LoggerPort, LogContext } from '../../../core/ports/LoggerPort';

export class PinoLoggerAdapter implements LoggerPort {
  private pino: pino.Logger;

  constructor(level: string = 'info', baseLogger?: pino.Logger) {
    this.pino = baseLogger ?? pino({ level });
  }

  debug(message: string, context?: LogContext): void {
    if (context) {
      this.pino.debug(context, message);
    } else {
      this.pino.debug(message);
    }
  }

  info(message: string, context?: LogContext): void {
    if (context) {
      this.pino.info(context, message);
    } else {
      this.pino.info(message);
    }
  }

  warn(message: string, context?: LogContext): void {
    if (context) {
      this.pino.warn(context, message);
    } else {
      this.pino.warn(message);
    }
  }

  error(message: string, error: unknown, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  error(message: string, errorOrContext?: unknown, context?: LogContext): void {
    if (context !== undefined) {
      this.pino.error({ err: errorOrContext, ...context }, message);
    } else if (errorOrContext instanceof Error) {
      this.pino.error({ err: errorOrContext }, message);
    } else if (typeof errorOrContext === 'object' && errorOrContext !== null) {
      this.pino.error(errorOrContext as Record<string, unknown>, message);
    } else if (errorOrContext !== undefined) {
      this.pino.error({ err: errorOrContext }, message);
    } else {
      this.pino.error(message);
    }
  }

  fatal(message: string, error: unknown, context?: LogContext): void;
  fatal(message: string, context?: LogContext): void;
  fatal(message: string, errorOrContext?: unknown, context?: LogContext): void {
    if (context !== undefined) {
      this.pino.fatal({ err: errorOrContext, ...context }, message);
    } else if (errorOrContext instanceof Error) {
      this.pino.fatal({ err: errorOrContext }, message);
    } else if (typeof errorOrContext === 'object' && errorOrContext !== null) {
      this.pino.fatal(errorOrContext as Record<string, unknown>, message);
    } else if (errorOrContext !== undefined) {
      this.pino.fatal({ err: errorOrContext }, message);
    } else {
      this.pino.fatal(message);
    }
  }

  child(bindings: LogContext): LoggerPort {
    return new PinoLoggerAdapter(this.pino.level, this.pino.child(bindings));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/driven/logger/PinoLoggerAdapter.test.ts`
Expected: PASS (all 7 tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/core/ports/LoggerPort.ts src/adapters/driven/logger/PinoLoggerAdapter.ts tests/adapters/driven/logger/PinoLoggerAdapter.test.ts
git commit -m "feat(logger): add LoggerPort and PinoLoggerAdapter

Introduce pure domain LoggerPort interface with method overloading for
first-class error handling. Implement PinoLoggerAdapter using pino for
NDJSON logging, context merging, and child logger inheritance."
```

---

### Task 3: Ingestion and Execution Logging in `ProcessIncomingMessage` Use Case

**Files:**
- Modify: `src/core/use-cases/ProcessIncomingMessage.ts`
- Modify: `tests/core/use-cases/ProcessIncomingMessage.test.ts`

**Interfaces:**
- Consumes: `LoggerPort`, `LogContext`
- Produces: `ProcessIncomingMessage(sender, llm, registry, logger)`

- [ ] **Step 1: Write the failing tests for `ProcessIncomingMessage` logging**

Update `tests/core/use-cases/ProcessIncomingMessage.test.ts` to supply `mockLogger` and assert child logger instantiation, debug discovery logging, info progress logging, and error logging:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessIncomingMessage } from '../../../src/core/use-cases/ProcessIncomingMessage';
import { MessageSenderPort } from '../../../src/core/ports/MessageSenderPort';
import { LLMPort } from '../../../src/core/ports/LLMPort';
import { PluginRegistryPort, Plugin } from '../../../src/core/ports/PluginRegistryPort';
import { Message } from '../../../src/core/entities/Message';
import { LoggerPort } from '../../../src/core/ports/LoggerPort';

describe('ProcessIncomingMessage', () => {
  let mockSender: MessageSenderPort;
  let mockLLM: LLMPort;
  let mockRegistry: PluginRegistryPort;
  let mockLogger: LoggerPort;

  beforeEach(() => {
    mockSender = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    mockLLM = { generateResponse: vi.fn() };
    mockRegistry = { getAvailablePlugins: vi.fn().mockReturnValue([]), executePlugin: vi.fn() };
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(),
    };
    vi.mocked(mockLogger.child).mockReturnValue(mockLogger);
  });

  it('should process a message and send text response with structured logging', async () => {
    vi.mocked(mockLLM.generateResponse).mockResolvedValue({ text: 'Hello back!' });

    const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry, mockLogger);
    const message: Message = { id: '1', userId: 'user1', content: 'Hi', timestamp: new Date() };

    await useCase.execute(message);

    expect(mockLogger.child).toHaveBeenCalledWith({ userId: 'user1', messageId: '1' });
    expect(mockLogger.info).toHaveBeenCalledWith('Processing incoming message');
    expect(mockLogger.debug).toHaveBeenCalledWith('Available tools discovered', { count: 0 });
    expect(mockLogger.info).toHaveBeenCalledWith('Message processed successfully');
    expect(mockSender.sendMessage).toHaveBeenCalledWith('user1', 'Hello back!');
  });

  it('should process a message and execute plugin with tool call logging', async () => {
    vi.mocked(mockLLM.generateResponse).mockResolvedValue({
      toolCall: {
        name: 'getWeather',
        arguments: { city: 'London' }
      }
    });
    const mockPlugin: Plugin = {
      name: 'getWeather',
      description: 'Get weather for a city',
      schema: {},
      execute: vi.fn().mockResolvedValue('Sunny in London')
    };
    vi.mocked(mockRegistry.getAvailablePlugins).mockReturnValue([mockPlugin]);
    vi.mocked(mockRegistry.executePlugin).mockResolvedValue('Sunny in London');

    const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry, mockLogger);
    const message: Message = { id: '2', userId: 'user2', content: 'Weather in London?', timestamp: new Date() };

    await useCase.execute(message);

    expect(mockLogger.info).toHaveBeenCalledWith('Executing tool call', { toolName: 'getWeather' });
    expect(mockRegistry.executePlugin).toHaveBeenCalledWith('getWeather', { city: 'London' });
    expect(mockSender.sendMessage).toHaveBeenCalledWith('user2', 'Sunny in London');
    expect(mockLogger.info).toHaveBeenCalledWith('Message processed successfully');
  });

  it('should not send a message when LLM response contains neither text nor toolCall', async () => {
    vi.mocked(mockLLM.generateResponse).mockResolvedValue({});

    const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry, mockLogger);
    const message: Message = { id: '3', userId: 'user3', content: 'Silence', timestamp: new Date() };

    await useCase.execute(message);

    expect(mockLLM.generateResponse).toHaveBeenCalled();
    expect(mockRegistry.executePlugin).not.toHaveBeenCalled();
    expect(mockSender.sendMessage).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith('Message processed successfully');
  });

  it('should send both text and tool result when LLM returns both text and toolCall', async () => {
    vi.mocked(mockLLM.generateResponse).mockResolvedValue({
      text: 'Checking the weather now...',
      toolCall: {
        name: 'getWeather',
        arguments: { city: 'London' }
      }
    });
    vi.mocked(mockRegistry.executePlugin).mockResolvedValue('Sunny in London');

    const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry, mockLogger);
    const message: Message = { id: '4', userId: 'user4', content: 'What is the weather in London?', timestamp: new Date() };

    await useCase.execute(message);

    expect(mockSender.sendMessage).toHaveBeenCalledTimes(2);
    expect(mockSender.sendMessage).toHaveBeenNthCalledWith(1, 'user4', 'Checking the weather now...');
    expect(mockSender.sendMessage).toHaveBeenNthCalledWith(2, 'user4', 'Sunny in London');
    expect(mockLogger.info).toHaveBeenCalledWith('Message processed successfully');
  });

  it('should log error and send error message when LLM generateResponse throws an error', async () => {
    const error = new Error('LLM API down');
    vi.mocked(mockLLM.generateResponse).mockRejectedValue(error);

    const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry, mockLogger);
    const message: Message = { id: '5', userId: 'user5', content: 'Hello', timestamp: new Date() };

    await useCase.execute(message);

    expect(mockLogger.error).toHaveBeenCalledWith('Failed to process message', error);
    expect(mockSender.sendMessage).toHaveBeenCalledWith('user5', 'An error occurred during processing.');
  });

  it('should log error and send error message when plugin execution throws an error', async () => {
    const error = new Error('Plugin crashed');
    vi.mocked(mockLLM.generateResponse).mockResolvedValue({
      toolCall: {
        name: 'failingPlugin',
        arguments: {}
      }
    });
    vi.mocked(mockRegistry.executePlugin).mockRejectedValue(error);

    const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry, mockLogger);
    const message: Message = { id: '6', userId: 'user6', content: 'Do something', timestamp: new Date() };

    await useCase.execute(message);

    expect(mockLogger.error).toHaveBeenCalledWith('Failed to process message', error);
    expect(mockSender.sendMessage).toHaveBeenCalledWith('user6', 'An error occurred during processing.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/use-cases/ProcessIncomingMessage.test.ts`
Expected: FAIL (Constructor does not accept 4 arguments or logger calls are missing).

- [ ] **Step 3: Update `ProcessIncomingMessage` to accept `LoggerPort` and log events**

Modify `src/core/use-cases/ProcessIncomingMessage.ts`:
```typescript
import { Message } from '../entities/Message';
import { MessageSenderPort } from '../ports/MessageSenderPort';
import { LLMPort } from '../ports/LLMPort';
import { PluginRegistryPort } from '../ports/PluginRegistryPort';
import { LoggerPort } from '../ports/LoggerPort';

export class ProcessIncomingMessage {
  constructor(
    private sender: MessageSenderPort,
    private llm: LLMPort,
    private registry: PluginRegistryPort,
    private logger: LoggerPort
  ) {}

  async execute(message: Message): Promise<void> {
    const log = this.logger.child({ userId: message.userId, messageId: message.id });
    log.info('Processing incoming message');

    try {
      const plugins = this.registry.getAvailablePlugins();
      log.debug('Available tools discovered', { count: plugins.length });

      // In future: fetch history from ChatRepository here
      const history: Message[] = [];

      const systemPrompt =
        'You are Iny, a friendly and highly concise assistant for college students. Never use emojis and keep answers under 2 sentences.';
      const response = await this.llm.generateResponse(systemPrompt, history, message, plugins);

      if (response.text) {
        await this.sender.sendMessage(message.userId, response.text);
      }

      if (response.toolCall) {
        log.info('Executing tool call', { toolName: response.toolCall.name });
        const toolResult = await this.registry.executePlugin(response.toolCall.name, response.toolCall.arguments);
        // Send tool result back to user for now (later, pass back to LLM for formatting)
        await this.sender.sendMessage(message.userId, toolResult);
      }

      log.info('Message processed successfully');
    } catch (error) {
      log.error('Failed to process message', error);
      await this.sender.sendMessage(message.userId, 'An error occurred during processing.');
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/use-cases/ProcessIncomingMessage.test.ts`
Expected: PASS (all 6 tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/core/use-cases/ProcessIncomingMessage.ts tests/core/use-cases/ProcessIncomingMessage.test.ts
git commit -m "feat(core): inject LoggerPort into ProcessIncomingMessage

Inject LoggerPort into ProcessIncomingMessage use case. Create child
logger with messageId and userId context. Add structured logs for
message ingestion, tool discovery, execution, completion, and errors."
```

---

### Task 4: Optional Logger DI for Driven Adapters (`DeepseekAdapter`, `InMemoryPluginRegistry`, `CLIAdapter`)

**Files:**
- Modify: `src/adapters/driven/llm/DeepseekAdapter.ts`
- Modify: `tests/adapters/driven/llm/DeepseekAdapter.test.ts`
- Modify: `src/adapters/driven/plugin-registry/InMemoryPluginRegistry.ts`
- Modify: `tests/adapters/driven/plugin-registry/InMemoryPluginRegistry.test.ts`
- Modify: `src/adapters/driving/cli/CLIAdapter.ts`
- Modify: `tests/adapters/driving/cli/CLIAdapter.test.ts`

**Interfaces:**
- Consumes: `LoggerPort`
- Produces: `DeepseekAdapter(apiKey, logger?)`, `InMemoryPluginRegistry(logger?)`, `CLIAdapter(useCase, rl?, logger?)`

- [ ] **Step 1: Write the failing tests for adapter logger injection**

In `tests/adapters/driven/llm/DeepseekAdapter.test.ts`, add test verifying logger receives debug logs and error logs:
```typescript
  it('should log debug info when optional logger is provided', async () => {
    const mockLogger: LoggerPort = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Logged response' } }],
    });

    const adapter = new DeepseekAdapter('test-key', mockLogger);
    const message: Message = { id: '1', userId: 'u1', content: 'test', timestamp: new Date() };

    await adapter.generateResponse('system', [], message, []);

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Sending request to Deepseek LLM',
      expect.objectContaining({ model: 'deepseek-flash' })
    );
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Received response from Deepseek LLM',
      expect.objectContaining({ hasToolCall: false })
    );
  });

  it('should log error and return fallback message when tool arguments are invalid JSON', async () => {
    const mockLogger: LoggerPort = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'calculate',
                  arguments: '{"invalid_json: true',
                },
              },
            ],
          },
        },
      ],
    });

    const adapter = new DeepseekAdapter('test-key', mockLogger);
    const response = await adapter.generateResponse(
      'system',
      [],
      { id: '1', userId: 'u1', content: 'calc', timestamp: new Date() },
      []
    );

    expect(mockLogger.error).toHaveBeenCalledWith('Failed to parse tool arguments', expect.any(Error));
    expect(response.text).toBe('Sorry, I encountered an error while processing the tool arguments.');
  });
```

In `tests/adapters/driven/plugin-registry/InMemoryPluginRegistry.test.ts`, add test verifying logger receives debug on register and error on failed execution:
```typescript
  it('should log registration and execution error when optional logger is provided', async () => {
    const mockLogger: LoggerPort = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const registry = new InMemoryPluginRegistry(mockLogger);
    const failingPlugin: Plugin = {
      name: 'fail',
      description: 'fails',
      schema: {},
      execute: vi.fn().mockRejectedValue(new Error('Boom')),
    };

    registry.register(failingPlugin);
    expect(mockLogger.debug).toHaveBeenCalledWith('Plugin registered', { pluginName: 'fail' });

    await registry.executePlugin('fail', {});
    expect(mockLogger.error).toHaveBeenCalledWith("Error executing plugin 'fail'", expect.any(Error));
  });
```

In `tests/adapters/driving/cli/CLIAdapter.test.ts`, add test verifying logger receives error on execution failure when logger is provided:
```typescript
  it('should log error to injected logger when message processing fails', async () => {
    const mockLogger: LoggerPort = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const error = new Error('Execution failed');
    mockUseCase.execute = vi.fn().mockRejectedValueOnce(error);

    const adapter = new CLIAdapter(mockUseCase, mockRl as unknown as readline.Interface, mockLogger);

    mockRl.question
      .mockImplementationOnce((_prompt: string, callback: (answer: string) => void) => {
        callback('trigger error');
      })
      .mockImplementationOnce((_prompt: string, callback: (answer: string) => void) => {
        callback('exit');
      });

    adapter.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockLogger.error).toHaveBeenCalledWith('Error processing message in CLI', error);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/driven/llm/DeepseekAdapter.test.ts tests/adapters/driven/plugin-registry/InMemoryPluginRegistry.test.ts tests/adapters/driving/cli/CLIAdapter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `DeepseekAdapter`, `InMemoryPluginRegistry`, and `CLIAdapter`**

In `src/adapters/driven/llm/DeepseekAdapter.ts`:
- Import `LoggerPort` from `../../../core/ports/LoggerPort`.
- Change constructor to: `constructor(apiKey: string, private logger?: LoggerPort)`
- In `generateResponse`:
  - Log request:
    ```typescript
    this.logger?.debug('Sending request to Deepseek LLM', {
      model: 'deepseek-flash',
      messageCount: messages.length,
    });
    ```
  - Log response:
    ```typescript
    this.logger?.debug('Received response from Deepseek LLM', {
      hasToolCall: Boolean(responseMessage.tool_calls && responseMessage.tool_calls.length > 0),
    });
    ```
  - In JSON parse error catch block:
    ```typescript
    if (this.logger) {
      this.logger.error('Failed to parse tool arguments', error);
    } else {
      console.error('Failed to parse tool arguments:', error);
    }
    ```

In `src/adapters/driven/plugin-registry/InMemoryPluginRegistry.ts`:
- Import `LoggerPort` from `../../../core/ports/LoggerPort`.
- Change constructor to: `constructor(private logger?: LoggerPort) {}`
- In `register`:
  ```typescript
  this.plugins.set(plugin.name, plugin);
  this.logger?.debug('Plugin registered', { pluginName: plugin.name });
  ```
- In `executePlugin` catch block:
  ```typescript
  if (this.logger) {
    this.logger.error(`Error executing plugin '${name}'`, error);
  } else {
    console.error(`Error executing plugin '${name}':`, error);
  }
  ```

In `src/adapters/driving/cli/CLIAdapter.ts`:
- Import `LoggerPort` from `../../../core/ports/LoggerPort`.
- Change constructor to:
  ```typescript
  constructor(
    private processMessageUseCase: ProcessIncomingMessage,
    rl?: readline.Interface,
    private logger?: LoggerPort
  )
  ```
- In `prompt` catch block:
  ```typescript
  if (this.logger) {
    this.logger.error('Error processing message in CLI', error);
  } else {
    console.error('Error processing message:', error);
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters`
Expected: PASS (all adapter tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/driven/llm/DeepseekAdapter.ts tests/adapters/driven/llm/DeepseekAdapter.test.ts src/adapters/driven/plugin-registry/InMemoryPluginRegistry.ts tests/adapters/driven/plugin-registry/InMemoryPluginRegistry.test.ts src/adapters/driving/cli/CLIAdapter.ts tests/adapters/driving/cli/CLIAdapter.test.ts
git commit -m "feat(adapters): inject optional LoggerPort into adapters

Accept optional LoggerPort in DeepseekAdapter, InMemoryPluginRegistry,
and CLIAdapter. Replace direct console logging with structured logger
calls when logger is provided while maintaining backwards compatibility."
```

---

### Task 5: Application Composition Root (`src/index.ts`) and Build Pipeline Verification

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `PinoLoggerAdapter`, `config.LOG_LEVEL`, `ProcessIncomingMessage`, `DeepseekAdapter`, `InMemoryPluginRegistry`, `CLIAdapter`
- Produces: Configured running application with centralized logging

- [ ] **Step 1: Check build before modifying `src/index.ts`**

Run: `npm run build`
Expected: FAIL with TypeScript error in `src/index.ts` (`Expected 4 arguments, but got 3` on `new ProcessIncomingMessage`).

- [ ] **Step 2: Update `src/index.ts` to instantiate and wire `PinoLoggerAdapter`**

Modify `src/index.ts`:
```typescript
import { ProcessIncomingMessage } from './core/use-cases/ProcessIncomingMessage';
import { CLIAdapter } from './adapters/driving/cli/CLIAdapter';
import { config } from './config';
import { DeepseekAdapter } from './adapters/driven/llm/DeepseekAdapter';
import { InMemoryPluginRegistry } from './adapters/driven/plugin-registry/InMemoryPluginRegistry';
import { CalculatorPlugin } from './plugins/CalculatorPlugin';
import { PinoLoggerAdapter } from './adapters/driven/logger/PinoLoggerAdapter';

const logger = new PinoLoggerAdapter(config.LOG_LEVEL);

const mockSender = {
  sendMessage: async (userId: string, text: string) => {
    console.log(`\n[Iny -> ${userId}]: ${text}\n`);
  }
};

const registry = new InMemoryPluginRegistry(logger);
registry.register(new CalculatorPlugin());

const deepseekAdapter = new DeepseekAdapter(config.DEEPSEEK_API_KEY, logger);
const useCase = new ProcessIncomingMessage(mockSender, deepseekAdapter, registry, logger);
const cli = new CLIAdapter(useCase, undefined, logger);

logger.info('Iny application started');
cli.start();
```

- [ ] **Step 3: Run build and tests to verify entire application**

Run:
```bash
npm run build
npm test
```
Expected:
- `npm run build` exits 0 with zero errors.
- `npm test` runs all 7 test files (50+ tests) and passes with 100% pristine output.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(app): wire PinoLoggerAdapter into composition root

Instantiate PinoLoggerAdapter with configured LOG_LEVEL. Pass logger to
use case and adapters in src/index.ts. Log application startup event."
```

---

## Plan Self-Review Checklist

1. **Spec Coverage:**
   - Section 3.1 (`LoggerPort` overloads, `LogContext`): Task 2.
   - Section 4.1 (`PinoLoggerAdapter` constructor & mapping): Task 2.
   - Section 4.2 (`LOG_LEVEL` Zod config): Task 1.
   - Section 4.3 (Pipeline & dependencies `pino`, `pino-pretty`): Task 1.
   - Section 5.1 (`ProcessIncomingMessage` logging): Task 3.
   - Section 5.2 (Driven adapters optional logger): Task 4.
   - Section 5.3 (Composition root `src/index.ts`): Task 5.
   - Section 6 (Unit testing & mock logger strategy): Tasks 1, 2, 3, 4, 5.

2. **Placeholder Scan:**
   - No "TBD", "TODO", or pseudo-code.
   - Every step has full, compilable code and exact commands.

3. **Type Consistency:**
   - `LoggerPort` methods: `debug`, `info`, `warn`, `error`, `fatal`, `child`.
   - `LogContext`: `Record<string, unknown>`.
   - All signatures match across Task 2, Task 3, Task 4, and Task 5.
