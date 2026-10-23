# Low-Level Design Reference: Object Design & Stereotypes in TypeScript

This reference guide establishes the principles of Responsibility-Driven Design (RDD) for Iny, categorizing object stereotypes, defining architectural cohesion, and enforcing interface boundaries across our Hexagonal Architecture.

---

## 1. Responsibility-Driven Object Design

Objects must be designed around **responsibilities** rather than raw data structures. A responsibility is an obligation to perform an action, know certain information, or coordinate collaborations.

When designing or refactoring classes and modules, ask:
1. *What does this object know?* (Knowledge responsibility)
2. *What does this object do?* (Action responsibility)
3. *Who does this object collaborate with?* (Collaboration responsibility)

---

## 2. The Four Primary Object Stereotypes

Every module, class, and interface in Iny fits into one of four primary architectural stereotypes:

```text
┌────────────────────────────────────────────────────────┐
│                      COORDINATOR                       │
│    (Orchestrates workflow, delegates computation)      │
│     e.g., ProcessIncomingMessage, AgentLoop            │
└───────────┬────────────────────────────────┬───────────┘
            │                                │
            ▼                                ▼
┌───────────────────────┐        ┌───────────────────────┐
│        SERVICE        │        │      INTERFACER       │
│  (Stateless compute,  │        │ (Bridges boundary /   │
│   utility algorithms) │        │  implements ports)    │
│  e.g., Temporal       │        │ e.g., PostgresRepo    │
└───────────┬───────────┘        └───────────┬───────────┘
            │                                │
            └───────────────┬────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│                   INFORMATION HOLDER                   │
│         (Pure domain state, immutable schemas)         │
│         e.g., Message, DialogueTurn, MessMeal          │
└────────────────────────────────────────────────────────┘
```

### 1. Information Holder
- **Purpose**: Encapsulates domain concepts, state, and identity.
- **Rules**:
  - In TypeScript, prefer immutable interfaces or classes with `readonly` fields.
  - Zero external runtime dependencies; 100% pure TypeScript.
  - Contains domain validation and state accessors; must NOT contain I/O, database access, or external network operations.
- **Iny Location**: `src/core/entities/`
- **Examples**: `Message`, `UserMessage`, `DialogueTurn`, `MessMeal`, `ToolCallRequest`.

### 2. Coordinator
- **Purpose**: Orchestrates multi-step workflows by dispatching tasks to collaborators without performing low-level computation or I/O directly.
- **Rules**:
  - Coordinates workflow stages: retrieval, reasoning, execution, persistence.
  - Depends exclusively on abstractions (`src/core/ports/`), never on concrete adapter classes.
  - Must remain lean and focused (< 150 lines per file, < 40 lines per method).
- **Iny Location**: `src/core/use-cases/`, `src/adapters/inbound/cli/` (CLI controllers)
- **Examples**: `ProcessIncomingMessage`, `AgentLoop`, `TriageCliController`.

### 3. Service
- **Purpose**: Performs pure domain calculations, stateless algorithms, or data transformations that do not naturally belong to a single entity.
- **Rules**:
  - Pure functions or stateless classes.
  - Deterministic: Same input yields same output without hidden environmental side effects.
  - Temporal calculations, timezone normalization, and string transformations must be placed here.
- **Iny Location**: `src/core/utils/`, `src/adapters/outbound/mess/formatting/`
- **Examples**: `Temporal` (`src/core/utils/Temporal.ts`), `TriagePreviewRenderer`, `DeepseekRequestMapper`.

### 4. Interfacer
- **Purpose**: Mediates communication across architectural boundaries (driving inbound triggers, driven outbound operations, external system translation).
- **Rules**:
  - Inbound interfacers translate incoming network/user events into domain entity calls.
  - Outbound interfacers translate domain port invocations into external driver calls (SQL, Baileys, HTTP).
  - Explicit port contract required: Outbound adapters MUST implement a port defined in `src/core/ports/`.
- **Iny Location**: `src/adapters/inbound/`, `src/adapters/outbound/`, `src/tools/`
- **Examples**: `WhatsAppInboundAdapter`, `PostgresMessRepository`, `DisplayMessCardTool`.

---

## 3. Core Design Principles

### High Cohesion
A class or module has high cohesion when all its methods and properties are tightly related to executing a single, clearly bounded responsibility.
- **Heuristic**: Can you describe the object's purpose in a single sentence without using the word "and"?
- **Negative Indicator**: A class containing rendering strings, SQL transactions, and CLI input prompts has low cohesion and must be split into separate collaborators.

### Loose Coupling
Modules should depend on the minimal necessary knowledge of other modules.
- **Heuristic**: Depend on abstract port interfaces (`MessStagingRepositoryPort`), never on concrete database classes (`PostgresMessStagingRepository`).
- **Benefit**: Adapters can be mocked in unit tests without starting database engines or socket connections.

### Tell, Don't Ask
Instead of querying an object's internal state and executing logic externally, instruct the object to perform the required domain operation.
- **Bad (Ask)**:
  ```typescript
  if (user.status === "active" && !user.isBlocked && user.tokenExpiresAt > Date.now()) {
    grantAccess(user);
  }
  ```
- **Good (Tell)**:
  ```typescript
  if (user.isEligibleForAccess(new Date())) {
    grantAccess(user);
  }
  ```

### Law of Demeter (Principle of Least Knowledge)
A method should only invoke methods on:
1. Itself (`this`).
2. Its method parameters.
3. Objects it instantiates directly.
4. Its direct constructor-injected collaborators.

Never chain through intermediate objects:
- **Violation**: `this.config.getDatabase().getConnection().execute(query);`
- **Compliant**: `this.database.execute(query);`

---

## 4. Iny Codebase Stereotype & Architectural Zone Mapping

| Zone | Stereotype | Primary Responsibility | Strict Boundary Constraints ("Does NOT Do") |
| :--- | :--- | :--- | :--- |
| `src/core/entities/` | Information Holder | Pure domain state & data structures | Zero external libraries, zero I/O, zero network, zero SQL. |
| `src/core/use-cases/` | Coordinator | Orchestrates core workflows & ReAct loop | Zero external runtime dependencies; interacts strictly via Ports. |
| `src/core/ports/` | Contract / Port | Explicit TypeScript interfaces for outbound calls | Zero implementation code; purely interface declarations. |
| `src/core/utils/` | Service | Pure deterministic utilities (time, math, parsing) | Zero side effects; no reliance on system clock without injection. |
| `src/adapters/inbound/` | Driving Interfacer | Adapts user/socket events to trigger use cases | Never imports outbound adapters, raw database clients, or SQL. |
| `src/adapters/outbound/` | Driven Interfacer | Implements core ports using concrete infrastructure | Never defines domain business rules; never orchestrates turns. |
| `src/tools/` | Domain Interfacer | Declares capability tools for LLM agent execution | Depends only on `BaseTool` and `src/core/ports/`; no outbound imports. |
| `src/index.ts` | Composition Root | Instantiates concrete adapters and wires dependencies | Zero application business logic; pure wiring and lifecycle bootstrap. |

---

## 5. TypeScript Idioms for Sound Object Design

### Discriminated Unions for Information Holders
Model state variants as explicit discriminated unions rather than wide interfaces with optional fields:
```typescript
export type AssistantMessage = AssistantTextMessage | AssistantToolCallMessage;

export interface AssistantTextMessage {
  readonly role: "assistant";
  readonly type: "text";
  readonly content: string;
}

export interface AssistantToolCallMessage {
  readonly role: "assistant";
  readonly type: "tool_calls";
  readonly toolCalls: readonly ValidToolCallRequest[];
}
```

### Template Method Pattern for Tools
Enforce consistent validation and error handling using abstract base classes without duplicating execution boilerplate:
```typescript
export abstract class BaseTool<TInput> implements Tool {
  public abstract readonly name: string;
  public abstract readonly description: string;
  protected abstract readonly schema: z.ZodSchema<TInput>;

  public async execute(rawInput: unknown): Promise<string> {
    const parsed = this.schema.safeParse(rawInput);
    if (!parsed.success) {
      return this.formatValidationError(parsed.error);
    }
    return this.run(parsed.data);
  }

  protected abstract run(input: TInput): Promise<string>;
}
```

### Strict Constructor Dependency Injection
Always inject dependencies through constructor arguments with explicit types. Disallow optional chains or dummy stubs:
```typescript
// Compliant: Explicit required dependency injection
export class ProcessIncomingMessage {
  constructor(
    private readonly chatRepo: ChatRepositoryPort,
    private readonly sender: MessageSenderPort,
    private readonly accessControl: AccessControlPort,
    private readonly logger: LoggerPort,
  ) {}
}
```
