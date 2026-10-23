# Low-Level Design Reference: Code Smells in TypeScript & Hexagonal Architecture

This reference guide categorizes code smells commonly observed in agentic and human software engineering, specifically contextualized for TypeScript and Hexagonal (Ports and Adapters) Architecture.

---

## 1. Primitive Obsession

### Definition
Relying on generic primitive types (`string`, `number`, `boolean`) to represent domain concepts with distinct validation rules, formatting requirements, or identities, rather than creating lightweight Value Objects or Branded Types.

### Symptoms in Hexagonal Architecture
- Methods across ports and use cases accept multiple raw `string` parameters with no compiler protection against transposing arguments.
- Validation logic (e.g., phone number regex, ISO timestamp formatting) is duplicated across inbound adapters, core use cases, and outbound repositories.
- Domain rules are coupled to primitive semantics (e.g., checking `mealType === "breakfast"` using untyped strings).

### Anti-Pattern Example
```typescript
// Anti-Pattern: Primitive string arguments easily transposed or unvalidated
export interface MessRepositoryPort {
  getResolvedMeal(mealDate: string, mealType: string, studentId: string): Promise<ResolvedMessMeal | null>;
}

// In use-case: caller accidentally swaps mealDate and studentId; compiler cannot help
const meal = await messRepo.getResolvedMeal(studentPhone, "2026-10-23", "lunch");
```

### Refactored Solution
```typescript
// Refactored: Strongly typed domain value types and branded types
export type IsoDateString = string & { readonly __brand: unique symbol };
export type StudentPhoneNumber = string & { readonly __brand: unique symbol };
export type MealSlot = "breakfast" | "lunch" | "snacks" | "dinner";

export interface MessRepositoryPort {
  getResolvedMeal(
    mealDate: IsoDateString,
    slot: MealSlot,
    studentId: StudentPhoneNumber,
  ): Promise<ResolvedMessMeal | null>;
}
```

### Remediation Strategy
- Introduce branded types or explicit type aliases for identifiers and domain strings.
- Encapsulate parsing and validation at the system boundary (adapters) using Zod or domain constructors.

---

## 2. God Classes & Large Classes

### Definition
Classes or modules that take on excessive responsibilities, accumulating hundreds of lines of code, managing multiple collaborators, and violating the Single Responsibility Principle.

### Symptoms in Hexagonal Architecture
- Files exceeding the constitution limit of 150 lines.
- Mixing presentation rendering (ANSI terminal formatting), transactional database queries, schema validation, and domain orchestration in a single class.
- High cognitive load; changes to CLI view formatting risk breaking SQL transaction handling.

### Anti-Pattern Example
```typescript
// Anti-Pattern: TriageTerminalView doing terminal rendering, DB queries, and Neovim editing
export class TriageTerminalView {
  constructor(private readonly db: PgDatabase<any>) {}

  public async renderTriageMenu(): Promise<void> { /* 100 lines of ANSI strings */ }
  public async previewStagedMessage(id: string): Promise<void> { /* 80 lines */ }
  public async spawnInteractiveEditor(id: string): Promise<void> { /* 120 lines child_process */ }
  public async commitMessageToDatabase(id: string): Promise<void> { /* 150 lines SQL transaction */ }
}
```

### Refactored Solution
```typescript
// Refactored: Decomposed into single-responsibility collaborators
// 1. Inbound Controller: Orchestrates user commands (< 150 lines)
export class TriageCliController {
  constructor(
    private readonly stagingRepo: MessStagingRepositoryPort,
    private readonly menuRenderer: TriageMenuRenderer,
    private readonly previewRenderer: TriagePreviewRenderer,
    private readonly jsonEditor: InteractiveJsonEditor,
  ) {}
}

// 2. Focused View Renderers: Dedicated purely to formatting (< 150 lines each)
export class TriageMenuRenderer { public renderMenu(): void {} }
export class TriagePreviewRenderer { public renderPreview(msg: StagedMessage): void {} }

// 3. Outbound Repositories: Dedicated to data persistence via ports
export class PostgresMessStagingRepository implements MessStagingRepositoryPort { /* pure DB */ }
```

### Remediation Strategy
- Extract distinct concerns: Separate presentation renderers, interactive shells, and persistence operations.
- Enforce the 150-line file threshold through ESLint `max-lines`.

---

## 3. Feature Envy

### Definition
A method or function that accesses the data of another object more than its own, often reaching into internal properties to perform calculations that belong on the target object.

### Symptoms in Hexagonal Architecture
- Use cases or adapters repeatedly extracting fields from entities to perform domain calculations (e.g., checking if a meal time has expired by calculating time differences outside the entity).
- Exposing mutable fields on entities with public getters/setters instead of behavior methods.

### Anti-Pattern Example
```typescript
// Anti-Pattern: Use case inspects meal timings, checks current clock, and mutates state
export class ProcessMealRequest {
  public execute(meal: MessMeal, currentTime: Date): boolean {
    const startHour = parseInt(meal.startTime.split(":")[0], 10);
    const startMin = parseInt(meal.startTime.split(":")[1], 10);
    const currentHour = currentTime.getHours();
    const currentMin = currentTime.getMinutes();
    
    // Feature envy: Doing date math that belongs on the domain object or Temporal utility
    return (currentHour > startHour) || (currentHour === startHour && currentMin >= startMin);
  }
}
```

### Refactored Solution
```typescript
// Refactored: Ask the domain model or dedicated domain service (Tell, Don't Ask)
export class ProcessMealRequest {
  constructor(private readonly temporal: TemporalService) {}

  public execute(meal: MessMeal, currentTime: Date): boolean {
    return this.temporal.isMealSlotActive(meal.timing, currentTime);
  }
}
```

### Remediation Strategy
- Apply "Tell, Don't Ask": Move behavior closer to the data it operates on.
- Consolidate domain calculations in domain entities or pure domain services.

---

## 4. Long Method

### Definition
A method or function exceeding 40 lines of code, combining control flow orchestration, data mapping, low-level error handling, and transaction boundaries into a single block.

### Symptoms in Hexagonal Architecture
- Function bodies exceeding the constitution limit of 40 lines.
- Deep nesting of `try/catch`, transaction callbacks, and conditionals.
- Difficulty in isolating edge cases or writing targeted unit tests.

### Anti-Pattern Example
```typescript
// Anti-Pattern: 70-line monolithic method handling validation, mapping, DB, and notifications
export class PostgresStagingQueue {
  public async processBatch(items: unknown[]): Promise<void> {
    for (const item of items) {
      if (item && typeof item === "object") {
        if ("id" in item) {
          try {
            // ... 20 lines of SQL transaction ...
            // ... 15 lines of JSON schema mapping ...
            // ... 15 lines of notification formatting ...
          } catch (err) {
            // ... nested error handling ...
          }
        }
      }
    }
  }
}
```

### Refactored Solution
```typescript
// Refactored: Composed of focused, descriptive helper steps under 40 lines
export class PostgresStagingQueue {
  public async processBatch(items: unknown[]): Promise<void> {
    const validItems = items.filter(this.isValidStagedItem);
    for (const item of validItems) {
      await this.processSingleItem(item);
    }
  }

  private isValidStagedItem(item: unknown): item is ValidStagedItem {
    return Boolean(item && typeof item === "object" && "id" in item);
  }

  private async processSingleItem(item: ValidStagedItem): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.persistItem(tx, item);
    });
  }
}
```

### Remediation Strategy
- Extract Private Helper Methods: Group cohesive operations into named functions.
- Flatten control flow with early return guard clauses.
- Enforce the 40-line limit through ESLint `max-lines-per-function`.

---

## 5. Shotgun Surgery

### Definition
A smell where a single conceptual change (e.g., updating date/time logic, changing an ID format) requires small, scattered modifications across many different files.

### Symptoms in Hexagonal Architecture
- IST time calculation and date string formatting (`"YYYY-MM-DD"`) implemented in 5 different files using differing date libraries or native methods.
- Changing the WhatsApp JID normalization logic requires editing multiple inbound and outbound adapters.

### Anti-Pattern Example
```typescript
// File A (AgentLoop.ts):
const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split("T")[0];

// File B (FoodAnnouncementsInboundAdapter.ts):
const now = new Date();
const istString = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);

// File C (DeepseekTextExtractor.ts):
const d = new Date();
const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
```

### Refactored Solution
```typescript
// Centralized in src/core/utils/Temporal.ts: Single source of truth
export class Temporal {
  public static getISTDateString(date: Date = new Date()): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }
}

// All consumers import the central utility:
const istDate = Temporal.getISTDateString();
```

### Remediation Strategy
- Consolidate shared utility logic into pure, centralized utilities in `src/core/utils/` or domain entities.
- Never duplicate date arithmetic, string normalization, or cryptographic routines.

---

## 6. Leaky Abstraction

### Definition
When an implementation detail of an outbound adapter (e.g., PostgreSQL table column names, Drizzle query objects, Baileys socket error codes) leaks into the domain core or inbound controllers.

### Symptoms in Hexagonal Architecture
- Domain use cases or tools importing `drizzle-orm` operators (`eq`, `sql`, `and_`).
- Core entities carrying database-specific decorators, primary key auto-increment metadata, or HTTP status codes.
- Tool schemas mirroring internal database schemas rather than the user/LLM intent contract.

### Anti-Pattern Example
```typescript
// Anti-Pattern: Inbound adapter importing Drizzle schema and executing DB query
import { db } from "../../../config";
import { whatsappGroupFoodAnnouncementsMessages } from "../../outbound/mess/postgres/schema";
import { eq } from "drizzle-orm";

export class FoodAnnouncementsInboundAdapter {
  public async handleAnnouncement(msgId: string): Promise<void> {
    // Leaky abstraction: raw database access inside driving adapter
    await db.update(whatsappGroupFoodAnnouncementsMessages)
      .set({ status: "processed" })
      .where(eq(whatsappGroupFoodAnnouncementsMessages.sourceMessageId, msgId));
  }
}
```

### Refactored Solution
```typescript
// Refactored: Adapter interacts exclusively via Core Port or Use Case
export class FoodAnnouncementsInboundAdapter {
  constructor(private readonly stagingRepo: MessStagingRepositoryPort) {}

  public async handleAnnouncement(msgId: string): Promise<void> {
    await this.stagingRepo.markProcessed(msgId);
  }
}
```

### Remediation Strategy
- Define explicit outbound ports in `src/core/ports/` with domain entity arguments and return types.
- Ensure all database schemas (`schema.ts`) and ORM dependencies remain isolated in `src/adapters/outbound/`.

---

## 7. Speculative Generality (Slopnought Anti-Pattern)

### Definition
Introducing abstract base classes, generic factories, uncalled helper functions, or multi-tenant switches anticipating "future requirements" that do not exist in the active feature specification.

### Symptoms in Hexagonal Architecture
- Uncalled factory classes (e.g., `MessMealFactory`) that exist solely to pass a unit test.
- Abstract classes or interfaces with only one concrete implementation and no polymorphism requirement.
- Generic type parameters `<TContext, TOptions>` that are always instantiated with a single type.

### Anti-Pattern Example
```typescript
// Anti-Pattern: Uncalled factory creating objects when plain object literals suffice
export class MessMealFactory {
  public static createMeal(slot: MealSlot, date: string, dishes: string[]): MessMeal {
    return { slot, date, dishes, location: "Main Mess", isSwapped: false };
  }
}
```

### Refactored Solution
```typescript
// Refactored: Plain TypeScript interface and direct construction
export interface MessMeal {
  readonly slot: MealSlot;
  readonly date: IsoDateString;
  readonly dishes: readonly string[];
  readonly location: string;
}

// Built directly where needed:
const meal: MessMeal = {
  slot: "lunch",
  date: "2026-10-23" as IsoDateString,
  dishes: ["Rice", "Dal", "Paneer"],
  location: "Main Mess",
};
```

### Remediation Strategy
- Apply the YAGNI principle (You Aren't Gonna Need It).
- If a class, method, or factory is not actively invoked in production runtime execution (`src/index.ts` flow), delete it.

---

## 8. Data Clumps

### Definition
Groups of parameters or fields that frequently appear together across multiple functions, parameter lists, and classes, but are never packaged into a cohesive type.

### Symptoms in Hexagonal Architecture
- Multiple functions repeating `(date: string, slot: string, messLocation: string)`.
- Fragile method signatures where changing or adding one parameter requires modifying signatures across multiple port and adapter interfaces.

### Anti-Pattern Example
```typescript
// Anti-Pattern: 4 separate parameters traveling together across 5 layers
export class MessService {
  public query(date: string, slot: string, location: string, studentId: string): Promise<void> {}
  public format(date: string, slot: string, location: string, studentId: string): string {}
  public persist(date: string, slot: string, location: string, studentId: string): Promise<void> {}
}
```

### Refactored Solution
```typescript
// Refactored: Cohesive Parameter Object / Entity
export interface MealQueryContext {
  readonly date: IsoDateString;
  readonly slot: MealSlot;
  readonly location: string;
  readonly studentId: StudentPhoneNumber;
}

export class MessService {
  public query(context: MealQueryContext): Promise<void> {}
  public format(context: MealQueryContext): string {}
  public persist(context: MealQueryContext): Promise<void> {}
}
```

### Remediation Strategy
- Group cohesive, recurring arguments into strongly-typed interfaces or domain value objects.
- Simplify port and adapter method signatures to accept the context object.
