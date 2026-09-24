# Codebase Hardening & Clean Low-Level Design Specification

## 1. Overview & Motivation

Following the implementation of the ReAct agentic loop and conversation memory, an exhaustive line-by-line audit across all 17 source files and 8 test suites revealed multiple low-level design flaws, Single Responsibility Principle (SRP) and Interface Segregation Principle (ISP) violations, leaky abstractions, and brittle testing patterns.

Specifically:
1. **Leaky Adapter Abstraction**: `DeepseekAdapter` invented an undocumented, underscore-prefixed sentinel property (`_parseError`) inside tool arguments when JSON parsing failed. `ProcessIncomingMessage` directly checked for this magic property, violating Dependency Inversion and Hexagonal Purity.
2. **Interface Segregation Violations**: `LLMPort` accepted `Plugin[]` containing executable methods (`execute()`), coupling prompt generation to tool execution.
3. **Ambiguous Nomenclature**: The codebase was split between "Plugin" (`PluginRegistryPort`, `Plugin`, `plugins/`) and "Tool" (`ToolCall`, `ToolMessage`, `maxToolIterations`).
4. **Monolithic Classes Violating SRP**:
   - `ProcessIncomingMessage` (231 lines) bundled turn orchestration, the iterative ReAct loop, concurrent tool execution, circuit breaker synthesis, message delivery, and turn persistence into a single class.
   - `DeepseekAdapter` (266 lines) bundled constructor normalization, message mapping, tool mapping, OpenAI SDK calls, error translation, response parsing, and tool argument deserialization into a single class.
5. **Flow Tautologies and Delivery Retry Bug**: `ProcessIncomingMessage` set `answerDelivered = true` unconditionally across both branches, yet called `sender.sendMessage()` inside helper methods. If message delivery threw a transport error, the catch block attempted to re-send an error notification through the dead transport.
6. **Double Logging**: `InMemoryPluginRegistry` logged tool execution errors with `logger.error` and re-threw them, after which `ProcessIncomingMessage` caught and logged them again as `logger.warn`.
7. **Ambiguous Logger Overloads**: `LoggerPort` overloaded `error` and `fatal` with both `(message, error, context)` and `(message, context)`, forcing `PinoLoggerAdapter` to run a 20-line runtime type-guessing maze.
8. **Lack of Declarative Tool Validation**: Plugins manually inspected untyped `Record<string, unknown>` dictionaries, risking parameter drift and duplicated validation logic.
9. **Brittle Test Suites**: Tests inspected private properties via `(adapter as any).rl`, asserted exact logger string prose, and spent 893 lines mocking OpenAI SDK internals for pure mapping logic.
10. **Undocumented Invariants**: Crucial contracts (chronological ordering in `ChatRepositoryPort`, structural invariants of `DialogueTurn`, transient DTO vs persistent entity lifecycles) lacked JSDoc documentation.

This specification establishes the contracts, data structures, and architectural decompositions required to eliminate all aforementioned technical debt and make Iny clean, maintainable, understandable, and extensible.

---

## 2. Architectural Map & Invariants

```text
src/
├── core/
│   ├── entities/
│   │   ├── Message.ts                  # Discriminated union: User, AssistantText, AssistantToolCall, Tool
│   │   ├── ToolCall.ts                 # Discriminated union: ValidToolCall | MalformedToolCall
│   │   └── DialogueTurn.ts             # Atomic turn transaction + assertion validator
│   ├── ports/
│   │   ├── ChatRepositoryPort.ts       # Chronological turn persistence port
│   │   ├── LLMPort.ts                  # Generates transient LLMResponse from messages and ToolDefinition[]
│   │   ├── LoggerPort.ts               # Unambiguous (message, error?, context?) structured logging
│   │   ├── MessageSenderPort.ts        # Outbound message transport port
│   │   └── ToolRegistryPort.ts         # Unified ToolDefinition retrieval & tool execution port
│   ├── errors/
│   │   └── LLMErrors.ts                # Structured domain errors with diagnostic metadata
│   └── use-cases/
│       ├── AgentLoop.ts                # Pure ReAct execution engine (turns, tools, circuit breaker)
│       └── ProcessIncomingMessage.ts   # Clean 4-step turn orchestrator
├── adapters/
│   ├── inbound/
│   │   └── cli/
│   │       └── CLIAdapter.ts           # Clean CLI driver using crypto.randomUUID()
│   └── outbound/
│       ├── chat-repository/
│       │   └── InMemoryChatRepository.ts # Clean sliding-window turn storage
│       ├── llm/
│       │   ├── DeepseekAdapter.ts      # Lightweight coordinator implementing LLMPort (~35 lines)
│       │   ├── DeepseekErrorTranslator.ts # Pure functions translating HTTP errors to LLMErrors
│       │   ├── DeepseekMessageMapper.ts   # Pure functions mapping domain to OpenAI schema
│       │   └── DeepseekResponseParser.ts  # Pure functions parsing OpenAI response to LLMResponse
│       ├── logger/
│       │   └── PinoLoggerAdapter.ts    # Streamlined Pino adapter without runtime type guessing
│       └── tool-registry/
│           └── InMemoryToolRegistry.ts # Unified tool registry without catch-and-rethrow logging
├── tools/
│   ├── BaseTool.ts                     # Declarative Zod base tool with automatic JSON Schema & validation
│   └── CalculatorTool.ts               # Arithmetic tool extending BaseTool
├── config.ts                           # Fail-fast environment configuration
└── index.ts                            # Composition root with explicit dependency injection
```

### Architectural Invariants
1. **Hexagonal Purity**: `src/core/` contains strictly TypeScript types, interfaces, classes, and assertion functions. Zero runtime external dependencies (no Zod, no Pino, no OpenAI).
2. **Unified Tool Nomenclature**: The term "Plugin" is retired across interfaces, directories, and classes in favor of "Tool" (`ToolDefinition`, `Tool`, `ToolRegistryPort`, `BaseTool`, `src/tools/`).
3. **Pure Mapper and Parser Isolation**: Wire translation logic in adapters must be implemented as pure, synchronous functions that can be tested without mock frameworks.
4. **Separation of Reasoning, Delivery, and Persistence**: The use case strictly delineates the AI reasoning phase, message delivery phase, and storage commit phase to prevent invalid retry attempts on dead transports.
5. **No Em Dashes in Code Documentation**: All JSDoc and code comments must avoid em dashes.

---

## 3. Core Entities & Contracts

### 3.1. `src/core/entities/ToolCall.ts`

Extracted from `Message.ts` into a dedicated file. Models tool calls as a discriminated union on `type` to distinguish valid parsed calls from syntax/parse failures.

```typescript
/**
 * A successfully parsed tool call requested by the LLM.
 */
export interface ValidToolCall {
  type: 'valid';
  /** Unique call identifier generated by the LLM provider. */
  id: string;
  /** Name of the tool requested. */
  name: string;
  /** Parsed JSON arguments matching the tool schema. */
  arguments: Record<string, unknown>;
}

/**
 * A tool call whose arguments failed JSON parsing or syntax validation.
 * Preserves the raw string emitted by the LLM for context reflection.
 */
export interface MalformedToolCall {
  type: 'malformed';
  /** Unique call identifier generated by the LLM provider. */
  id: string;
  /** Name of the tool requested. */
  name: string;
  /** The unparseable raw string emitted by the model. */
  rawArguments: string;
  /** Description of the parsing syntax error. */
  parseError: string;
}

/**
 * Discriminated union of tool invocations requested by the model.
 * Discriminant is the "type" property ('valid' | 'malformed').
 */
export type ToolCall = ValidToolCall | MalformedToolCall;
```

### 3.2. `src/core/entities/Message.ts`

Imports `ToolCall` from `./ToolCall`. Clarifies roles and enforces discrimination.

```typescript
import { ToolCall } from './ToolCall';

/**
 * Common identity fields shared by all message types in the system.
 */
export interface BaseMessage {
  /** Unique identifier for the message. */
  id: string;
  /** Identifier of the user this message belongs to. */
  userId: string;
  /** Timestamp when the message was created. */
  timestamp: Date;
}

/**
 * An inbound message sent by the user. Always starts a DialogueTurn.
 */
export interface UserMessage extends BaseMessage {
  role: 'user';
  content: string;
}

/**
 * A final natural language response from the assistant delivered to the user.
 * Always concludes a DialogueTurn.
 */
export interface AssistantTextMessage extends BaseMessage {
  role: 'assistant';
  content: string;
  thought?: string;
  toolCalls?: never;
}

/**
 * An intermediate assistant response requesting one or more tool calls.
 * Never delivered to the user. Must be followed by ToolMessage results.
 */
export interface AssistantToolCallMessage extends BaseMessage {
  role: 'assistant';
  content?: string;
  thought?: string;
  toolCalls: ToolCall[];
}

export type AssistantMessage = AssistantTextMessage | AssistantToolCallMessage;

/**
 * The output of a tool execution fed back into the model context.
 */
export interface ToolMessage extends BaseMessage {
  role: 'tool';
  /** Links this execution result to the originating ToolCall id. */
  toolCallId: string;
  /** The name of the tool that was executed. */
  name: string;
  /** The stringified result or error message. */
  content: string;
}

/**
 * Top-level discriminated union for all conversation messages.
 * Discriminant is the "role" property ('user' | 'assistant' | 'tool').
 */
export type Message = UserMessage | AssistantMessage | ToolMessage;
```

### 3.3. `src/core/entities/DialogueTurn.ts`

Defines the atomic conversation boundary and introduces a pure domain validator.

```typescript
import { Message } from './Message';

/**
 * A complete, atomic exchange between a user and the assistant.
 * Pruned and retrieved as an indivisible unit to preserve context boundaries.
 */
export interface DialogueTurn {
  /** Unique identifier for the turn. */
  id: string;
  /** The user who participated in this dialogue exchange. */
  userId: string;
  /**
   * Ordered sequence of messages for this turn.
   * Invariant: [UserMessage, ...(AssistantToolCallMessage + ToolMessage[])*, AssistantTextMessage]
   */
  messages: Message[];
  /** Timestamp when the turn was completed and persisted. */
  createdAt: Date;
}
```

---

## 4. Core Ports & Contracts

### 4.1. `src/core/ports/ToolRegistryPort.ts`

Replaces `PluginRegistryPort.ts`. Segregates metadata descriptors (`ToolDefinition`) from executable tools (`Tool`).

```typescript
/**
 * Read-only metadata describing a tool for LLM prompt construction.
 * Free of executable code, preventing interface coupling in LLM adapters.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

/**
 * An executable tool implementation.
 */
export interface Tool extends ToolDefinition {
  execute(args: Record<string, unknown>): Promise<string>;
}

/**
 * Outbound port for tool discovery and execution.
 */
export interface ToolRegistryPort {
  /**
   * Returns metadata descriptors for all registered tools.
   */
  getToolDefinitions(): ToolDefinition[];

  /**
   * Executes a tool by name with validated arguments.
   * Throws an error if the tool name is unknown.
   */
  executeTool(name: string, args: Record<string, unknown>): Promise<string>;
}
```

### 4.2. `src/core/ports/LLMPort.ts`

Renames `history` to `messages` and accepts `ToolDefinition[]` instead of executable plugins.

```typescript
import { ToolDefinition } from './ToolRegistryPort';
import { Message } from '../entities/Message';
import { ToolCall } from '../entities/ToolCall';

export interface BaseLLMDecision {
  thought?: string;
}

export interface ToolCallDecision extends BaseLLMDecision {
  type: 'tool_calls';
  toolCalls: ToolCall[];
}

export interface TextResponseDecision extends BaseLLMDecision {
  type: 'text';
  content: string;
}

export type LLMResponse = ToolCallDecision | TextResponseDecision;

export interface GenerateResponseOptions {
  forcedSynthesis?: boolean;
}

export interface LLMPort {
  /**
   * Requests reasoning or text generation from the language model.
   *
   * @param systemPrompt Instructions defining persona and constraints.
   * @param messages Full chronological conversation sequence for this generation step.
   * @param tools Available tool definitions for function calling.
   * @param options Additional generation controls like forced synthesis.
   */
  generateResponse(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[],
    options?: GenerateResponseOptions
  ): Promise<LLMResponse>;
}
```

### 4.3. `src/core/ports/LoggerPort.ts`

Eliminates ambiguous method overloads in favor of explicit `(message, error?, context?)` signatures.

```typescript
export type LogContext = Record<string, unknown>;

export interface LoggerPort {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, error?: unknown, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;
  fatal(message: string, error?: unknown, context?: LogContext): void;
  child(bindings: LogContext): LoggerPort;
}
```

### 4.4. `src/core/ports/ChatRepositoryPort.ts`

Explicitly documents chronological ordering contracts in JSDoc.

```typescript
import { DialogueTurn } from '../entities/DialogueTurn';

export interface ChatRepositoryPort {
  /**
   * Retrieves recent dialogue turns for a user, ordered chronologically from oldest to newest.
   * Returns an empty array if maxTurns is less than or equal to 0 or no turns exist.
   */
  getRecentTurns(userId: string, maxTurns: number): Promise<DialogueTurn[]>;

  /**
   * Persists a completed dialogue turn atomically.
   */
  saveTurn(turn: DialogueTurn): Promise<void>;

  /**
   * Wipes all persisted turns for a user.
   */
  clearHistory(userId: string): Promise<void>;
}
```

---

## 5. Use Case & Domain Service Decomposition

### 5.1. `src/core/use-cases/AgentLoop.ts`

Extracted from `ProcessIncomingMessage`. Owns the iterative ReAct loop, concurrent tool execution, error reflection, and circuit breaker forced synthesis. Has **zero** dependencies on `MessageSenderPort` or `ChatRepositoryPort`.

```typescript
export interface AgentLoopConfig {
  systemPrompt: string;
  maxToolIterations?: number;
}

export interface AgentLoopResult {
  finalText: string;
  thought?: string;
  sessionMessages: Message[];
}

export class AgentLoop {
  private readonly maxToolIterations: number;
  private readonly systemPrompt: string;

  constructor(
    private llm: LLMPort,
    private registry: ToolRegistryPort,
    config: AgentLoopConfig
  ) {
    this.systemPrompt = config.systemPrompt;
    this.maxToolIterations = config.maxToolIterations ?? 5;
  }

  async run(
    userMessage: UserMessage,
    history: Message[],
    tools: ToolDefinition[],
    log: LoggerPort
  ): Promise<AgentLoopResult> {
    const sessionMessages: Message[] = [userMessage];
    let iteration = 0;

    while (iteration < this.maxToolIterations) {
      const workingMessages = [...history, ...sessionMessages];
      const response = await this.llm.generateResponse(
        this.systemPrompt,
        workingMessages,
        tools
      );

      if (response.type === 'text') {
        const content = response.content.trim() !== ''
          ? response.content
          : 'I apologize, but I was unable to formulate a response.';
        const assistantMessage: AssistantTextMessage = {
          id: crypto.randomUUID(),
          userId: userMessage.userId,
          role: 'assistant',
          content,
          thought: response.thought,
          timestamp: new Date(),
        };
        sessionMessages.push(assistantMessage);
        return { finalText: content, thought: response.thought, sessionMessages };
      }

      // Handle tool calls step
      const toolCallMessage: AssistantToolCallMessage = {
        id: crypto.randomUUID(),
        userId: userMessage.userId,
        role: 'assistant',
        thought: response.thought,
        toolCalls: response.toolCalls,
        timestamp: new Date(),
      };
      sessionMessages.push(toolCallMessage);

      const toolResults = await this.executeToolsConcurrently(
        userMessage.userId,
        response.toolCalls,
        log
      );
      sessionMessages.push(...toolResults);
      iteration++;
    }

    // Circuit breaker forced synthesis
    return this.handleCircuitBreaker(userMessage.userId, history, sessionMessages, tools, log);
  }

  private async executeToolsConcurrently(
    userId: string,
    toolCalls: ToolCall[],
    log: LoggerPort
  ): Promise<ToolMessage[]> {
    return Promise.all(
      toolCalls.map(async (tc): Promise<ToolMessage> => {
        if (tc.type === 'malformed') {
          log.warn('Tool call arguments were malformed', undefined, {
            toolName: tc.name,
            parseError: tc.parseError,
          });
          return {
            id: crypto.randomUUID(),
            userId,
            role: 'tool',
            toolCallId: tc.id,
            name: tc.name,
            content: `Error executing tool '${tc.name}': Failed to parse tool arguments: ${tc.parseError}`,
            timestamp: new Date(),
          };
        }

        try {
          log.info('Executing tool call', { toolName: tc.name });
          const result = await this.registry.executeTool(tc.name, tc.arguments);
          return {
            id: crypto.randomUUID(),
            userId,
            role: 'tool',
            toolCallId: tc.id,
            name: tc.name,
            content: result,
            timestamp: new Date(),
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          log.warn('Tool execution failed', error, { toolName: tc.name });
          return {
            id: crypto.randomUUID(),
            userId,
            role: 'tool',
            toolCallId: tc.id,
            name: tc.name,
            content: `Error executing tool '${tc.name}': ${errorMessage}`,
            timestamp: new Date(),
          };
        }
      })
    );
  }

  private async handleCircuitBreaker(
    userId: string,
    history: Message[],
    sessionMessages: Message[],
    tools: ToolDefinition[],
    log: LoggerPort
  ): Promise<AgentLoopResult> {
    log.warn('Max tool iterations reached, forcing synthesis', undefined, {
      maxIterations: this.maxToolIterations,
    });

    const workingMessages = [...history, ...sessionMessages];
    const forcedResponse = await this.llm.generateResponse(
      this.systemPrompt,
      workingMessages,
      tools,
      { forcedSynthesis: true }
    );

    const rawContent = forcedResponse.type === 'text' ? forcedResponse.content : '';
    const content = rawContent.trim() !== ''
      ? rawContent
      : "I've reached the maximum number of tool iterations and was unable to complete your request.";

    const assistantMessage: AssistantTextMessage = {
      id: crypto.randomUUID(),
      userId,
      role: 'assistant',
      content,
      thought: forcedResponse.thought,
      timestamp: new Date(),
    };
    sessionMessages.push(assistantMessage);

    return { finalText: content, thought: forcedResponse.thought, sessionMessages };
  }
}
```

### 5.2. `src/core/use-cases/ProcessIncomingMessage.ts`

Transforms into a clean, 4-phase orchestrator. Separates reasoning, delivery, and persistence.

```typescript
export interface ProcessIncomingMessageConfig {
  maxHistoryTurns?: number;
}

export class ProcessIncomingMessage {
  private readonly maxHistoryTurns: number;

  constructor(
    private sender: MessageSenderPort,
    private chatRepository: ChatRepositoryPort,
    private agentLoop: AgentLoop,
    private toolRegistry: ToolRegistryPort,
    private logger: LoggerPort,
    config?: ProcessIncomingMessageConfig
  ) {
    this.maxHistoryTurns = config?.maxHistoryTurns ?? 10;
  }

  async execute(message: UserMessage): Promise<void> {
    const log = this.logger.child({ userId: message.userId, messageId: message.id });
    log.info('Processing incoming message');

    // 1. REASONING PHASE
    let loopResult: AgentLoopResult;
    try {
      const history = await this.loadHistoricalMessages(message.userId);
      const tools = this.toolRegistry.getToolDefinitions();
      loopResult = await this.agentLoop.run(message, history, tools, log);
    } catch (reasoningError) {
      this.handleReasoningError(reasoningError, log);
      await this.safeSendFallback(message.userId, reasoningError, log);
      return;
    }

    // 2. DELIVERY PHASE
    try {
      await this.sender.sendMessage(message.userId, loopResult.finalText);
    } catch (deliveryError) {
      log.error('Failed to deliver message to user via transport', deliveryError);
      // Transport failed: do not attempt to send error notification through the dead transport.
      return;
    }

    // 3. PERSISTENCE PHASE
    try {
      const turn: DialogueTurn = {
        id: crypto.randomUUID(),
        userId: message.userId,
        messages: loopResult.sessionMessages,
        createdAt: new Date(),
      };
      await this.chatRepository.saveTurn(turn);
      log.info('Message processed successfully');
    } catch (persistenceError) {
      log.error('Failed to persist dialogue turn', persistenceError);
      // User already received their message, so do not crash or message user.
    }
  }

  private async loadHistoricalMessages(userId: string): Promise<Message[]> {
    const recentTurns = await this.chatRepository.getRecentTurns(userId, this.maxHistoryTurns);
    return recentTurns.flatMap((turn) => turn.messages);
  }

  private handleReasoningError(error: unknown, log: LoggerPort): void {
    if (error instanceof LLMAuthenticationError || error instanceof LLMInsufficientBalanceError) {
      log.fatal('Unrecoverable LLM account or authentication failure', error, {
        status: error.status,
        code: error.code,
      });
    } else {
      log.error('Failed during reasoning loop', error, {
        status: error instanceof LLMError ? error.status : undefined,
        code: error instanceof LLMError ? error.code : undefined,
      });
    }
  }

  private async safeSendFallback(userId: string, error: unknown, log: LoggerPort): Promise<void> {
    try {
      const userMessage = error instanceof LLMRateLimitError || error instanceof LLMServerOverloadedError
        ? 'Iny is experiencing heavy traffic right now. Please try again in a moment.'
        : 'An error occurred during processing.';
      await this.sender.sendMessage(userId, userMessage);
    } catch (fallbackError) {
      log.error('Failed to send error notification to user', fallbackError);
    }
  }
}
```

---

## 6. Outbound Adapters Decomposition

### 6.1. `src/adapters/outbound/llm/` Decomposition

The monolithic 266-line `DeepseekAdapter` is decomposed into 3 pure, synchronous mapping modules and 1 clean coordinator.

#### `DeepseekMessageMapper.ts`
Pure function converting `Message[]` into OpenAI `ChatCompletionMessageParam[]`.
- Maps `thought` to `reasoning_content` on assistant messages.
- Maps `ValidToolCall` by stringifying `arguments`.
- Maps `MalformedToolCall` by echoing back the raw unparsed string in `arguments`.
- Pure, synchronous, zero external network dependencies.

#### `DeepseekResponseParser.ts`
Pure function converting OpenAI `ChatCompletion` into domain `LLMResponse`.
- Checks `finish_reason === 'tool_calls'` or presence of `message.tool_calls`.
- Extracts `reasoning_content` into `thought`.
- Deserializes tool arguments: if JSON parses successfully $\to$ creates `ValidToolCall`. If parsing throws $\to$ creates `MalformedToolCall` carrying `rawArguments` and `parseError`.
- Pure, synchronous, zero network dependencies.

#### `DeepseekErrorTranslator.ts`
Pure function translating raw exceptions into domain error subclasses (`LLMAuthenticationError`, `LLMInsufficientBalanceError`, `LLMRateLimitError`, etc.).

#### `DeepseekAdapter.ts` (Clean Coordinator ~35 lines)
```typescript
export interface DeepseekAdapterOptions {
  baseURL?: string;
  model?: string;
  logger?: LoggerPort;
}

export class DeepseekAdapter implements LLMPort {
  private client: OpenAI;
  private baseURL: string;
  private model: string;
  private logger?: LoggerPort;

  constructor(apiKey: string, options?: DeepseekAdapterOptions) {
    this.logger = options?.logger;
    this.baseURL = options?.baseURL ?? 'https://api.deepseek.com';
    this.model = options?.model ?? 'deepseek-flash';
    this.client = new OpenAI({ apiKey, baseURL: this.baseURL });
  }

  async generateResponse(
    systemPrompt: string,
    messages: Message[],
    tools: ToolDefinition[],
    options?: GenerateResponseOptions
  ): Promise<LLMResponse> {
    const openAIMessages = mapDomainMessagesToOpenAI(systemPrompt, messages);
    const openAITools = mapToolDefinitionsToOpenAI(tools, options?.forcedSynthesis);

    this.logger?.debug('Sending request to Deepseek LLM', {
      model: this.model,
      messageCount: openAIMessages.length,
    });

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: openAIMessages,
        tools: openAITools,
        tool_choice: openAITools ? 'auto' : undefined,
      });
      return parseOpenAIResponse(response, this.logger);
    } catch (error) {
      translateAndThrowDeepseekError(error);
    }
  }
}
```

### 6.2. `src/adapters/outbound/tool-registry/InMemoryToolRegistry.ts`

- Renamed from `InMemoryPluginRegistry.ts`.
- Removes the catch-log-rethrow pattern: `executeTool()` directly invokes the tool without duplicate logging.
- Implements `getToolDefinitions()` returning metadata stripped of `execute`.

### 6.3. `src/adapters/outbound/logger/PinoLoggerAdapter.ts`

- Replaces the 20-line type-guessing maze with a clean, 25-line implementation mapping `(message, error?, context?)` directly to Pino's `{ ...context, err: error }`.

---

## 7. Declarative Tool Architecture (`BaseTool.ts`)

### `src/tools/BaseTool.ts`

Provides a reusable base class leveraging Zod outside the core boundary.

```typescript
import { z } from 'zod';
import { Tool, ToolDefinition } from '../core/ports/ToolRegistryPort';

export abstract class BaseTool<TSchema extends z.ZodType> implements Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly schema: TSchema;

  get definition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      schema: z.toJSONSchema(this.schema) as Record<string, unknown>,
    };
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const parsed = this.schema.safeParse(args);
    if (!parsed.success) {
      return `Error: Invalid tool arguments: ${z.prettifyError(parsed.error)}`;
    }
    return this.run(parsed.data);
  }

  abstract run(args: z.infer<TSchema>): Promise<string>;
}
```

### `src/tools/CalculatorTool.ts`
Extends `BaseTool<typeof calculatorSchema>`. Eliminates manual `typeof` and empty string checks from `execute()`.

---

## 8. Inbound Adapter & Composition Root

### 8.1. `src/adapters/inbound/cli/CLIAdapter.ts`
- Uses `crypto.randomUUID()` for `UserMessage.id`.
- Removes `(adapter as any).rl` test anti-pattern.

### 8.2. `src/index.ts`
- Renames `mockSender` to `consoleSender`.
- Wires the decoupled `AgentLoop` and `ProcessIncomingMessage` instances explicitly.
- Instantiates `DeepseekAdapter` using the single options object constructor.

---

## 9. Testing Strategy & Hygiene

1. **Pure Unit Tests for Mappers and Parsers**:
   - `tests/adapters/outbound/llm/DeepseekMessageMapper.test.ts`: Tests all message role transformations, thought mapping, and malformed tool argument echoing synchronously with zero mocks.
   - `tests/adapters/outbound/llm/DeepseekResponseParser.test.ts`: Tests text extraction, parallel tool calls, malformed JSON argument detection with zero mocks.
   - `tests/adapters/outbound/llm/DeepseekErrorTranslator.test.ts`: Tests HTTP error mapping with zero mocks.
2. **Lean `DeepseekAdapter.test.ts`**:
   - Reduces from 893 lines to approximately 60 lines, verifying only that the client coordinates mapper, SDK, and parser.
3. **Isolated `AgentLoop.test.ts`**:
   - Tests the ReAct loop, iteration limit circuit breaking, parallel execution, and tool error reflection without mocking `MessageSenderPort` or `ChatRepositoryPort`.
4. **Behavioral `ProcessIncomingMessage.test.ts`**:
   - Tests 4-phase orchestration, error messaging on reasoning failure, transport error handling on delivery failure, and turn validation on persistence failure.
   - Removes brittle log string assertions (`expect(mockChildLogger.info).toHaveBeenCalledWith('...')`).
5. **No Private Field Invasions**:
   - Eliminates `(adapter as any).rl` checks from test suites.

---

## 10. JSDoc Documentation Rules

1. Every interface, class, method, and entity must include JSDoc comments.
2. Comments must explicitly document contracts, parameter constraints, and return values.
3. **Rule**: Do NOT use em dashes in any JSDoc or code comments. Use standard colons, commas, or parentheses instead.
