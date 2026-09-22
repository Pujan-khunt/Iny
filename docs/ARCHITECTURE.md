# System Architecture

## 1. System Vision & The Hexagonal Boundary

Iny serves as a highly modular, zero-trust WhatsApp bot engine powered by LLMs. Our core philosophy relies heavily on Hexagonal Architecture (Ports and Adapters). The **Domain Core** (`src/core`) contains zero external dependencies and remains pure. It dictates the business logic and how messages should be processed. Adapters handle all interaction with the outside world (like WhatsApp, CLI, LLMs, and external plugins) by implementing interfaces (ports) defined by the core.

## 2. Mental Model & Core Concepts

- **Entity**: Central data structures representing domain concepts:
  - `src/core/entities/Message.ts`: Discriminated union of `UserMessage`, `AssistantMessage` (`AssistantTextMessage` | `AssistantToolCallMessage`), and `ToolMessage`.
  - `src/core/entities/DialogueTurn.ts`: Encapsulates a complete, turn-atomic interaction boundary (`UserMessage`, intermediate tool calls/results, and final `AssistantMessage`).
- **Use Case**: Application-specific business rules. `src/core/use-cases/ProcessIncomingMessage.ts` orchestrates loading historical turns, the iterative ReAct tool loop, concurrent tool execution, circuit breaker forced synthesis, user message delivery, and atomic turn persistence.
- **Ports**: Interfaces that define how the core communicates with the outside world without knowing implementation details.
  - `src/core/ports/MessageSenderPort.ts`
  - `src/core/ports/LLMPort.ts`
  - `src/core/ports/ChatRepositoryPort.ts`
  - `src/core/ports/LoggerPort.ts`
  - `src/core/ports/PluginRegistryPort.ts`
- **Inbound Adapters**: Entry points that trigger core use cases. For example, `src/adapters/inbound/cli/CLIAdapter.ts` simulates user interaction via the command line.
- **Outbound Adapters**: Concrete implementations of our core ports that interact with external services.
  - `src/adapters/outbound/llm/DeepseekAdapter.ts`
  - `src/adapters/outbound/chat-repository/InMemoryChatRepository.ts`
  - `src/adapters/outbound/logger/PinoLoggerAdapter.ts`
  - `src/adapters/outbound/plugin-registry/InMemoryPluginRegistry.ts`
- **Plugins**: Modular tool extensions available to the LLM, such as `src/plugins/CalculatorPlugin.ts`.

## 3. Codebase Directory Map

```text
src/
├── core/                           # The Pure Domain Core (Zero External Dependencies)
│   ├── entities/
│   │   ├── Message.ts              # Message discriminated union
│   │   └── DialogueTurn.ts         # Turn-atomic conversation unit
│   ├── use-cases/
│   │   └── ProcessIncomingMessage.ts # ReAct loop & memory orchestration
│   ├── ports/                      # Interfaces for external dependencies
│   │   ├── ChatRepositoryPort.ts   # Conversation history persistence port
│   │   ├── LLMPort.ts              # Language model reasoning & tool call port
│   │   ├── LoggerPort.ts           # Structured logging port
│   │   ├── MessageSenderPort.ts    # Outbound messaging transport port
│   │   └── PluginRegistryPort.ts   # Dynamic tool registry port
│   └── errors/
│       └── LLMErrors.ts            # Custom domain errors
├── adapters/                       # Interaction with the outside world
│   ├── inbound/
│   │   └── cli/
│   │       └── CLIAdapter.ts       # Command line interface for manual testing
│   └── outbound/
│       ├── chat-repository/
│       │   └── InMemoryChatRepository.ts # In-memory sliding window turn storage
│       ├── llm/
│       │   └── DeepseekAdapter.ts  # DeepSeek V4.1 Flash OpenAI-compatible adapter
│       ├── logger/
│       │   └── PinoLoggerAdapter.ts# Structured logging using Pino
│       └── plugin-registry/
│           └── InMemoryPluginRegistry.ts # Manages available plugins
├── plugins/
│   └── CalculatorPlugin.ts         # Example plugin (tool) for the LLM
├── config.ts                       # Fail-fast configuration with Zod
└── index.ts                        # The Composition Root
```

## 4. Canonical Control & Data Flow

```mermaid
sequenceDiagram
    participant Input as CLI [WhatsApp planned]
    participant CLI as CLIAdapter.ts
    participant UC as ProcessIncomingMessage.ts
    participant Repo as ChatRepositoryPort.ts
    participant Reg as PluginRegistryPort.ts
    participant LLM as LLMPort.ts
    participant Sender as MessageSenderPort.ts
    participant Log as LoggerPort.ts

    Input->>CLI: User sends message
    CLI->>UC: execute(message)
    UC->>Log: logger.info("Processing incoming message")
    UC->>Repo: chatRepository.getRecentTurns(userId, maxHistoryTurns)
    Repo-->>UC: DialogueTurn[] (history)
    UC->>Reg: registry.getAvailablePlugins()
    Reg-->>UC: Array of plugins

    loop ReAct Tool Loop (up to maxToolIterations)
        UC->>LLM: llm.generateResponse(systemPrompt, workingHistory, plugins)
        alt Response: Text
            LLM-->>UC: { type: 'text', content, thought }
            UC->>Sender: sender.sendMessage(userId, content)
            Note over UC: Break loop
        else Response: Tool Calls
            LLM-->>UC: { type: 'tool_calls', toolCalls, thought }
            UC->>Reg: Promise.all(plugins.executePlugin(...))
            Reg-->>UC: Tool results / reflected errors
            Note over UC: Append tool messages to workingHistory & iterate
        end
    end

    opt Circuit Breaker (if max iterations reached without text)
        UC->>LLM: llm.generateResponse(systemPrompt, workingHistory, plugins, { forcedSynthesis: true })
        LLM-->>UC: { type: 'text', content }
        UC->>Sender: sender.sendMessage(userId, content)
    end

    UC->>Repo: chatRepository.saveTurn(completedTurn)
    UC->>Log: logger.info("Message processed successfully")
    UC-->>CLI: Done
```

## 5. Architectural Invariants

- **Pure Core**: `src/core/` must never import from outside of itself. It contains solely TypeScript interfaces, classes, and types.
- **Turn-Atomic Conversation Memory**: History persistence is partitioned into complete `DialogueTurn` boundaries. Sliding windows and retention limits prune complete turns, never bisecting an assistant tool call from its corresponding tool response.
- **Single Composition Root**: In production runtime code, `src/index.ts` is the only place where adapters and the core are stitched together. Dependency injection is wired up here (unit tests and internal adapter factory methods like `PinoLoggerAdapter.child()` may instantiate adapters directly).
- **Fail-Fast Startup**: `src/config.ts` uses Zod to validate all environment variables at startup. If configuration is invalid, the application fails immediately before any business logic is executed.

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

### Recipe 3: Create Plugin/Tool
1. Create a new plugin in `src/plugins/` (e.g., `WeatherPlugin.ts`).
2. Ensure it adheres to the plugin interface required by `PluginRegistryPort`.
3. Register the plugin with the plugin registry adapter in `src/index.ts`.

### Recipe 4: Finalize Feature & Atomic Spec Archival
1. Ensure full test coverage (`npm test`) and build success (`npm run build`).
2. Move the active specification from `docs/specs/` to `docs/specs/archive/` within the same feature branch.
3. Commit and submit pull request.
