# Low-Level Design Reference: SOLID Principles in TypeScript & Hexagonal Architecture

This reference guide details the practical application of the SOLID principles within Iny's TypeScript codebase, specifically illustrating how each principle governs Core Entities, Use Cases, Ports, and Adapters.

---

## 1. Single Responsibility Principle (SRP)

> *“A class or module should have one, and only one, reason to change.”*

In Iny, an object's single reason to change is anchored to a specific actor and architectural zone:
- **Core Entities**: Change only when domain concepts or business rules evolve.
- **Use Cases**: Change only when application workflow orchestration changes.
- **Adapters**: Change only when external transport, protocol, or storage technology changes.
- **Renderers / Formatters**: Change only when visual or text presentation requirements change.

### Violation Example (God Module)
```typescript
// Anti-Pattern: TriageTerminalView doing ANSI UI, user prompts, and database persistence
export class TriageTerminalView {
  constructor(private readonly db: PgDatabase<any>) {}

  // Reason to change 1: Terminal ANSI style or color palette changes
  public renderMenu(): void { /* ... */ }

  // Reason to change 2: CLI input prompt navigation changes
  public async promptUserAction(): Promise<string> { /* ... */ }

  // Reason to change 3: Database transaction or schema changes
  public async commitStagedMeal(id: string): Promise<void> {
    await this.db.transaction(async (tx) => { /* SQL transaction */ });
  }
}
```

### Compliant Example (Decomposed Collaborators)
```typescript
// 1. Driving Controller: Orchestrates user flow (< 150 lines)
export class TriageCliController {
  constructor(
    private readonly stagingRepo: MessStagingRepositoryPort,
    private readonly menuRenderer: TriageMenuRenderer,
    private readonly promptService: TerminalPromptService,
  ) {}

  public async run(): Promise<void> {
    this.menuRenderer.render();
    const action = await this.promptService.askUser();
    if (action === "commit") {
      await this.stagingRepo.atomicCommit(this.currentMessageId);
    }
  }
}

// 2. Focused View Renderer: Pure presentation (< 150 lines)
export class TriageMenuRenderer {
  public render(): void { /* pure ANSI output */ }
}

// 3. Outbound Adapter: Pure database persistence implementing Port (< 150 lines)
export class PostgresMessStagingRepository implements MessStagingRepositoryPort {
  public async atomicCommit(id: string): Promise<void> { /* pure SQL transaction */ }
}
```

---

## 2. Open-Closed Principle (OCP)

> *“Software entities should be open for extension, but closed for modification.”*

In Hexagonal Architecture, OCP is achieved primarily through **Ports** and polymorphic dispatch. You should be able to introduce a new external transport, LLM provider, or capability tool without modifying existing core orchestrators.

### Violation Example (Hardcoded Conditionals)
```typescript
// Anti-Pattern: Modifying core use case every time a new tool is introduced
export class AgentLoop {
  public async executeTool(toolName: string, args: unknown): Promise<string> {
    if (toolName === "calculator") {
      return new Calculator().compute(args);
    } else if (toolName === "display_mess_card") {
      return new MessCardHandler().display(args);
    } else if (toolName === "query_mess_details") {
      return new MessDetailsHandler().query(args);
    }
    throw new Error(`Unknown tool: ${toolName}`);
  }
}
```

### Compliant Example (Polymorphic Registry Extension)
```typescript
// Open for extension: Tool contract allows adding arbitrary tools
export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly isTerminal: boolean;
  execute(input: unknown): Promise<string>;
}

// Core Use Case remains closed for modification:
export class AgentLoop {
  constructor(private readonly toolRegistry: ToolRegistryPort) {}

  public async executeTool(name: string, args: unknown): Promise<string> {
    const tool = this.toolRegistry.getTool(name);
    if (!tool) {
      throw new UnknownToolError(name);
    }
    return tool.execute(args);
  }
}

// New tools are added by implementing Tool without touching AgentLoop:
export class CalculatorTool extends BaseTool<CalcInput> { /* ... */ }
export class DisplayMessCardTool extends BaseTool<MessCardInput> { /* ... */ }
```

---

## 3. Liskov Substitution Principle (LSP)

> *“Subtypes must be substitutable for their base types without altering program correctness.”*

When an outbound adapter implements a core port, it must fully satisfy the behavioral contract defined by that port:
1. It must not throw unexpected exceptions not declared in the port.
2. It must not return `null` or `undefined` when the port contract guarantees a value.
3. In-memory test doubles and production adapters must exhibit identical domain semantics.

### Violation Example (Contract Violation in Subtype)
```typescript
export interface ChatRepositoryPort {
  getRecentTurns(userId: string, limit: number): Promise<DialogueTurn[]>;
}

// Anti-Pattern: Production adapter returns undefined on empty or throws unexpected DB error
export class PostgresChatRepository implements ChatRepositoryPort {
  public async getRecentTurns(userId: string, limit: number): Promise<DialogueTurn[]> {
    try {
      const records = await this.db.select().from(dialogueTurns);
      if (records.length === 0) {
        // Violates contract: Port expects empty array [], not null/undefined
        return null as unknown as DialogueTurn[];
      }
      return records.map(this.toDomain);
    } catch (err) {
      // Violates LSP: Leaking raw Postgres connection error instead of domain failure
      throw new DatabaseConnectionError("Postgres failed");
    }
  }
}
```

### Compliant Example (Strict Contract Adherence)
```typescript
export class PostgresChatRepository implements ChatRepositoryPort {
  public async getRecentTurns(userId: string, limit: number): Promise<DialogueTurn[]> {
    try {
      const records = await this.db
        .select()
        .from(dialogueTurns)
        .where(eq(dialogueTurns.userId, userId))
        .orderBy(desc(dialogueTurns.completedAt))
        .limit(limit);

      // Always returns an array, never null or undefined
      return records.map(this.toDomain);
    } catch (error) {
      this.logger.error("Failed to query dialogue turns", { error, userId });
      // Adheres to LSP: Returns empty or throws documented domain error
      throw new RepositoryQueryError(`Failed to fetch dialogue turns for ${userId}`, { cause: error });
    }
  }
}
```

---

## 4. Interface Segregation Principle (ISP)

> *“Clients should not be forced to depend on interfaces they do not use.”*

Never create monolithic "god ports". Break down wide interfaces into focused, role-specific contracts tailored to the client's needs.

### Violation Example (Monolithic God Port)
```typescript
// Anti-Pattern: 20-method monolithic port forcing all clients to depend on everything
export interface MessRepositoryPort {
  // Read queries (needed by student chat use-cases)
  getResolvedMeal(date: string, slot: string): Promise<ResolvedMessMeal | null>;
  getWeeklyMenu(): Promise<MessMenu>;

  // Staging operations (needed only by admin triage CLI)
  listStagedMessages(): Promise<StagedMessage[]>;
  getMessageById(id: string): Promise<StagedMessage | null>;
  atomicCommit(id: string): Promise<void>;
  atomicUndo(id: string): Promise<void>;
  atomicReset(id: string): Promise<void>;

  // Scraping / sync operations (needed only by background worker)
  scrapeLatestAnnouncements(): Promise<void>;
}
```

### Compliant Example (Segregated Role-Specific Ports)
```typescript
// 1. Read Port: Consumed by student conversational use cases
export interface MessRepositoryPort {
  getResolvedMeal(date: IsoDateString, slot: MealSlot): Promise<ResolvedMessMeal | null>;
  getWeeklyMenu(): Promise<MessMenu>;
}

// 2. Staging & Transaction Port: Consumed exclusively by admin CLI controller
export interface MessStagingRepositoryPort {
  listStagedMessages(): Promise<StagedMessage[]>;
  getMessageById(id: string): Promise<StagedMessage | null>;
  atomicCommit(id: string): Promise<void>;
  atomicUndo(id: string): Promise<void>;
  atomicReset(id: string): Promise<void>;
}

// 3. Synchronization Port: Consumed by announcement ingestion workers
export interface AnnouncementSyncPort {
  scrapeLatestAnnouncements(): Promise<void>;
}
```

---

## 5. Dependency Inversion Principle (DIP)

> *“High-level modules should not depend on low-level modules. Both should depend on abstractions. Abstractions should not depend on details. Details should depend on abstractions.”*

This is the bedrock of Hexagonal Architecture:
1. **Core Use Cases** (`src/core/use-cases/`) contain business workflows and depend **only** on Port interfaces (`src/core/ports/`).
2. **Outbound Adapters** (`src/adapters/outbound/`) contain infrastructure details and depend on Port interfaces (`implements Port`).
3. **Inbound Adapters** (`src/adapters/inbound/`) drive the system by invoking Core Use Cases or querying Core Ports.
4. **Composition Root** (`src/index.ts`) is the only place permitted to instantiate concrete adapters and inject them into use cases.

### Violation Example (Core Depending on Concrete Infrastructure)
```typescript
// Anti-Pattern: Core use case importing concrete PostgreSQL adapter directly
import { PostgresChatRepository } from "../../adapters/outbound/chat-repository/postgres/PostgresChatRepository";
import { BaileysMessageSenderAdapter } from "../../adapters/outbound/whatsapp/BaileysMessageSenderAdapter";

export class ProcessIncomingMessage {
  // Violates DIP: Directly coupled to concrete Postgres and WhatsApp implementations
  private chatRepo = new PostgresChatRepository();
  private sender = new BaileysMessageSenderAdapter();
}
```

### Compliant Example (Pure Inversion via Port Interfaces)
```typescript
// Core Use Case depends strictly on abstract Port interfaces
export class ProcessIncomingMessage {
  constructor(
    private readonly chatRepo: ChatRepositoryPort,
    private readonly sender: MessageSenderPort,
    private readonly accessControl: AccessControlPort,
    private readonly logger: LoggerPort,
  ) {}

  public async execute(message: UserMessage): Promise<void> {
    // Pure domain orchestration
    const turns = await this.chatRepo.getRecentTurns(message.userId, 10);
    // ...
    await this.sender.sendMessage(message.recipient, responseText);
  }
}

// Composition Root (src/index.ts) wires details to abstractions at startup:
const chatRepo: ChatRepositoryPort = new PostgresChatRepository(db, logger);
const sender: MessageSenderPort = new BaileysMessageSenderAdapter(socket, logger);
const processor = new ProcessIncomingMessage(chatRepo, sender, accessControl, logger);
```

---

## 6. Summary: Applying SOLID Across Hexagonal Layers

| Principle | Core Entities (`src/core/entities/`) | Core Use Cases (`src/core/use-cases/`) | Core Ports (`src/core/ports/`) | Adapters (`src/adapters/`) |
| :--- | :--- | :--- | :--- | :--- |
| **SRP** | Encapsulates domain invariants only. No I/O or utils. | Orchestrates one workflow. Delegates computation to services. | Defines one capability contract. | Handles single external protocol, tool, or database table. |
| **OCP** | Extended via Discriminated Unions. | Extended by injecting new Port implementations. | Extended by defining new Port interfaces. | Adapters added without modifying existing core code. |
| **LSP** | Entity variants satisfy union contract. | Consistent handling of all port implementations. | Clear, complete method contracts and failure types. | Implementations obey port semantics and error handling. |
| **ISP** | Focused entity interfaces. | Depends only on required Port interfaces. | Fine-grained, role-focused interfaces. | Implements specific ports without bloated unused methods. |
| **DIP** | 100% pure TypeScript; zero dependencies. | Depends strictly on Port interfaces. | Owned by the Core; driven by domain requirements. | Implements core ports; wired only at `src/index.ts`. |
