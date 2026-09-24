# System Architecture

## 1. System Vision & The Hexagonal Boundary

Iny serves as a highly modular, zero-trust WhatsApp bot engine powered by LLMs. Our core philosophy relies heavily on Hexagonal Architecture (Ports and Adapters). The **Domain Core** (`src/core`) contains zero external runtime dependencies and remains pure. It dictates the business logic and how messages should be processed. Adapters handle all interaction with the outside world (like WhatsApp, CLI, LLMs, and tool registries) by implementing interfaces (ports) defined by the core.

## 2. Mental Model & Core Concepts

- **Entities**: Pure data structures representing domain concepts:
  - `src/core/entities/Message.ts`: Discriminated union of `UserMessage`, `AssistantMessage` (`AssistantTextMessage` | `AssistantToolCallMessage`), and `ToolMessage`.
  - `src/core/entities/ToolCall.ts`: Discriminated union of `ValidToolCall` and `MalformedToolCall` modeling parsed LLM function invocations.
  - `src/core/entities/DialogueTurn.ts`: Encapsulates a complete, turn-atomic interaction boundary (`UserMessage`, intermediate tool calls and results, and final `AssistantMessage`).
- **Use Cases & Domain Services**: Application-specific business rules:
  - `src/core/use-cases/ProcessIncomingMessage.ts`: 3-phase orchestrator separating Reasoning, Delivery, and Persistence phases. Isolates dead transport failures and prevents ghost turns in conversation memory.
  - `src/core/use-cases/AgentLoop.ts`: Pure domain service executing the ReAct (Reasoning + Acting) loop. Manages concurrent tool execution via `Promise.all`, circuit breaker forced synthesis, and malformed tool error injection.
- **Ports**: Interfaces that define how the core communicates with the outside world without knowing implementation details:
  - `src/core/ports/MessageSenderPort.ts`: Outbound messaging transport.
  - `src/core/ports/LLMPort.ts`: Language model reasoning and tool call generation.
  - `src/core/ports/ChatRepositoryPort.ts`: Conversation history persistence.
  - `src/core/ports/LoggerPort.ts`: Structured, leveled logging.
  - `src/core/ports/ToolRegistryPort.ts`: Tool registration and execution contracts (`ToolDefinition` and `Tool`).
- **Tools**: Declarative tool extensions available to the LLM:
  - `src/tools/BaseTool.ts`: Abstract base class using the Template Method pattern, declarative Zod schemas, automatic JSON Schema generation, and self-correcting error string returns.
  - `src/tools/CalculatorTool.ts`: Safe arithmetic evaluation tool using recursive descent parsing (zero `eval`).
- **Inbound Adapters**: Entry points that trigger core use cases:
  - `src/adapters/inbound/cli/CLIAdapter.ts`: Interactive command line interface with standardized UUID message identity and signal handling.
- **Outbound Adapters**: Concrete implementations of our core ports:
  - `src/adapters/outbound/llm/DeepseekAdapter.ts`: Lean coordinator delegating to pure collaborators:
    - `DeepseekMessageMapper.ts`: Pure message translation to OpenAI-compatible format with DeepSeek `reasoning_content` support.
    - `DeepseekResponseParser.ts`: Pure parser extracting `ValidToolCall` and `MalformedToolCall` domain entities.
    - `DeepseekErrorTranslator.ts`: Pure HTTP error status translator.
  - `src/adapters/outbound/chat-repository/InMemoryChatRepository.ts`: In-memory sliding-window turn repository preserving chronological order and tenant isolation.
  - `src/adapters/outbound/logger/PinoLoggerAdapter.ts`: Structured logging wrapper around Pino with unambiguous signature routing.
  - `src/adapters/outbound/tool-registry/InMemoryToolRegistry.ts`: In-memory tool storage exposing clean tool definitions.

## 3. Codebase Directory Map

```text
src/
├── core/                                   # The Pure Domain Core (Zero External Dependencies)
│   ├── entities/
│   │   ├── Message.ts                      # Message discriminated union
│   │   ├── ToolCall.ts                     # ValidToolCall and MalformedToolCall union
│   │   └── DialogueTurn.ts                 # Turn-atomic conversation unit
│   ├── use-cases/
│   │   ├── ProcessIncomingMessage.ts       # 3-phase orchestrator (Reasoning, Delivery, Persistence)
│   │   └── AgentLoop.ts                    # Pure ReAct reasoning loop & tool concurrency
│   ├── ports/                              # Interfaces for external dependencies
│   │   ├── ChatRepositoryPort.ts           # Conversation history persistence port
│   │   ├── LLMPort.ts                      # Language model reasoning & tool call port
│   │   ├── LoggerPort.ts                   # Structured logging port
│   │   ├── MessageSenderPort.ts            # Outbound messaging transport port
│   │   └── ToolRegistryPort.ts             # Tool registry and execution port
│   └── errors/
│       └── LLMErrors.ts                    # Custom domain error hierarchy
├── tools/                                  # Concrete Domain Tools
│   ├── BaseTool.ts                         # Declarative base tool with Zod schema reflection
│   └── CalculatorTool.ts                   # Safe recursive descent arithmetic evaluator
├── adapters/                               # Interaction with the outside world
│   ├── inbound/
│   │   └── cli/
│   │       └── CLIAdapter.ts               # Command line interface for manual testing
│   └── outbound/
│       ├── chat-repository/
│       │   └── InMemoryChatRepository.ts   # In-memory sliding window turn storage
│       ├── llm/
│       │   ├── DeepseekAdapter.ts          # Lean coordinator for DeepSeek completions
│       │   ├── DeepseekMessageMapper.ts    # Pure domain to OpenAI message mapper
│       │   ├── DeepseekResponseParser.ts   # Pure OpenAI response parser
│       │   └── DeepseekErrorTranslator.ts  # Pure HTTP and SDK error translator
│       ├── logger/
│       │   └── PinoLoggerAdapter.ts        # Structured logging using Pino
│       └── tool-registry/
│           └── InMemoryToolRegistry.ts     # In-memory tool registry implementation
├── config.ts                               # Fail-fast configuration with pure parseConfig
└── index.ts                                # The Composition Root
```

## 4. Canonical Control & Data Flow

```mermaid
sequenceDiagram
    participant Input as CLI [WhatsApp planned]
    participant CLI as CLIAdapter.ts
    participant UC as ProcessIncomingMessage.ts
    participant Loop as AgentLoop.ts
    participant Repo as ChatRepositoryPort.ts
    participant Reg as ToolRegistryPort.ts
    participant LLM as LLMPort.ts
    participant Sender as MessageSenderPort.ts
    participant Log as LoggerPort.ts

    Input->>CLI: User sends message
    CLI->>UC: execute(message)
    UC->>Log: logger.child({ userId, messageId })
    UC->>Log: log.info("Processing incoming message")

    rect rgb(240, 248, 255)
        Note over UC,Loop: Phase 1: Reasoning Phase
        UC->>Repo: chatRepository.getRecentTurns(userId, maxHistoryTurns)
        Repo-->>UC: DialogueTurn[] (history)
        UC->>Reg: toolRegistry.getToolDefinitions()
        Reg-->>UC: ToolDefinition[]
        UC->>Loop: loop.run(message, history, tools, log)

        loop ReAct Tool Loop (up to maxToolIterations)
            Loop->>LLM: llm.generateResponse(systemPrompt, workingHistory, tools)
            alt Response: Text
                LLM-->>Loop: { type: 'text', content, thought }
                Note over Loop: Break loop
            else Response: Tool Calls
                LLM-->>Loop: { type: 'tool_calls', toolCalls, thought }
                Loop->>Reg: Promise.all(toolCalls.map(executeTool))
                Reg-->>Loop: Tool results / reflected error strings
                Note over Loop: Append tool messages to workingHistory & iterate
            end
        end

        opt Circuit Breaker (if max iterations reached without text)
            Loop->>LLM: llm.generateResponse(systemPrompt, workingHistory, tools, { forcedSynthesis: true })
            LLM-->>Loop: { type: 'text', content }
        end
        Loop-->>UC: loopResult (finalText, thought, sessionMessages)
    end

    rect rgb(240, 255, 240)
        Note over UC,Sender: Phase 2: Delivery Phase
        UC->>Sender: sender.sendMessage(userId, finalText)
        alt Delivery Fails
            Sender-->>UC: Transport Error
            UC->>Log: log.error("Failed to deliver message...")
            Note over UC: Abort (do not retry over dead transport; do not save turn)
        end
    end

    rect rgb(255, 250, 240)
        Note over UC,Repo: Phase 3: Persistence Phase
        UC->>Repo: chatRepository.saveTurn(turn)
        UC->>Log: log.info("Message processed successfully")
    end

    UC-->>CLI: Return
```

## 5. Architectural Invariants

- **Pure Core**: `src/core/` must never import from outside of itself. It contains solely pure TypeScript interfaces, entities, use cases, and errors with zero runtime external dependencies.
- **Turn-Atomic Conversation Memory**: History persistence is partitioned into complete `DialogueTurn` boundaries. Sliding windows and retention limits prune complete turns, never bisecting an assistant tool call from its corresponding tool response.
- **Single Composition Root**: In production runtime code, `src/index.ts` is the only place where adapters and the core are stitched together. Dependency injection is wired up here (unit tests and internal adapter factory methods like `PinoLoggerAdapter.child()` may instantiate adapters directly).
- **Fail-Fast Startup**: `src/config.ts` uses Zod to validate all environment variables at startup. Pure `parseConfig()` is exported for direct testing without dynamic module reloading.

## 6. "How Do I..." Recipe Guide

### Recipe 1: Add Inbound Adapter
1. Create a new directory in `src/adapters/inbound/` (e.g., `whatsapp/`).
2. Write an adapter class that takes use cases (e.g., `ProcessIncomingMessage`) as dependencies.
3. Listen to external events (like a webhook or socket message) and invoke the use case.
4. Wire it up in `src/index.ts`.

### Recipe 2: Add Outbound Port & Adapter
1. Define the port interface in `src/core/ports/` (e.g., `DatabasePort.ts`).
2. Create the adapter in `src/adapters/outbound/` (e.g., `postgres/PostgresAdapter.ts`) implementing the port.
3. Inject it into the necessary use cases via `src/index.ts`.

### Recipe 3: Create a Tool
1. Create a new tool file in `src/tools/` (e.g., `WeatherTool.ts`).
2. Define a declarative Zod schema for its input parameters.
3. Extend `BaseTool<typeof schema>` and implement `protected async run(args: z.infer<typeof schema>): Promise<string>`.
4. Register the tool with `InMemoryToolRegistry` in `src/index.ts`.

### Recipe 4: Pre-Merge Review & Archival Ritual
1. Perform an in-depth review of all PR changes (architecture, correctness, test coverage, and code hygiene).
2. Review and update `docs/ARCHITECTURE.md` to ensure architectural documentation accurately reflects all boundaries and flows.
3. Move the completed feature specification from `docs/specs/` to `docs/specs/archive/` within the same feature branch.
4. Verify all tests pass (`npm test`) and compilation succeeds (`npm run build`).
5. Commit and merge the pull request.
