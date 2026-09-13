# Iny Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core architecture of Iny, including the domain entities, ports, the main use case, a CLI adapter for testing, and the Deepseek LLM integration.

**Architecture:** Hexagonal Architecture (Ports and Adapters). The core business logic (`src/core`) defines interfaces (`ports`) that are implemented by external dependencies (`src/adapters`). A plugin registry manages extensible tools.

**Tech Stack:** Node.js, TypeScript, Vitest (testing), OpenAI SDK (for Deepseek API compatibility), `pg` (node-postgres).

**Spec:** `docs/superpowers/specs/2026-09-13-iny-core-architecture-design.md`

## Global Constraints

- Node.js runtime environment.
- Strict TypeScript (`"strict": true` in tsconfig).
- No external imports in `src/core` (except for basic types if needed).
- All code must have corresponding tests.
- Commits must follow Conventional Commits.

---

### Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.js`

**Interfaces:**
- Consumes: N/A
- Produces: A working TS environment with Vitest.

- [ ] **Step 1: Initialize Project**

```bash
npm init -y
npm install typescript @types/node ts-node --save-dev
npm install vitest --save-dev
```

- [ ] **Step 2: Configure TypeScript**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "rootDir": "./src",
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Configure Vitest**

Update `package.json` to include the test script:
```json
"scripts": {
  "test": "vitest run"
}
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json tsconfig.json
git commit -m "chore: setup typescript and vitest"
```

---

### Task 2: Core Entities & Ports

**Files:**
- Create: `src/core/entities/Message.ts`
- Create: `src/core/ports/MessageSenderPort.ts`
- Create: `src/core/ports/LLMPort.ts`
- Create: `src/core/ports/PluginRegistryPort.ts`

**Interfaces:**
- Consumes: N/A
- Produces: Types and Interfaces used by the rest of the system.

- [ ] **Step 1: Create Message Entity**

Create `src/core/entities/Message.ts`:
```typescript
export interface Message {
  id: string;
  userId: string;
  content: string;
  timestamp: Date;
}
```

- [ ] **Step 2: Create Ports**

Create `src/core/ports/MessageSenderPort.ts`:
```typescript
export interface MessageSenderPort {
  sendMessage(userId: string, content: string): Promise<void>;
}
```

Create `src/core/ports/PluginRegistryPort.ts`:
```typescript
export interface Plugin {
  name: string;
  description: string;
  schema: Record<string, any>;
  execute(args: any): Promise<string>;
}

export interface PluginRegistryPort {
  getAvailablePlugins(): Plugin[];
  executePlugin(name: string, args: any): Promise<string>;
}
```

Create `src/core/ports/LLMPort.ts`:
```typescript
import { Plugin } from './PluginRegistryPort';
import { Message } from '../entities/Message';

export interface LLMResponse {
  text?: string;
  toolCall?: {
    name: string;
    arguments: any;
  };
}

export interface LLMPort {
  generateResponse(history: Message[], newMessage: Message, plugins: Plugin[]): Promise<LLMResponse>;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/core/entities src/core/ports
git commit -m "feat(core): define entities and ports"
```

---

### Task 3: Core Use Case (ProcessIncomingMessage)

**Files:**
- Create: `tests/core/use-cases/ProcessIncomingMessage.test.ts`
- Create: `src/core/use-cases/ProcessIncomingMessage.ts`

**Interfaces:**
- Consumes: `Message`, `MessageSenderPort`, `LLMPort`, `PluginRegistryPort`
- Produces: `ProcessIncomingMessage` class with `execute(msg: Message)` method.

- [ ] **Step 1: Write the failing test**

Create `tests/core/use-cases/ProcessIncomingMessage.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { ProcessIncomingMessage } from '../../../src/core/use-cases/ProcessIncomingMessage';
import { MessageSenderPort } from '../../../src/core/ports/MessageSenderPort';
import { LLMPort, LLMResponse } from '../../../src/core/ports/LLMPort';
import { PluginRegistryPort, Plugin } from '../../../src/core/ports/PluginRegistryPort';

describe('ProcessIncomingMessage', () => {
  it('should process a message and send text response', async () => {
    const mockSender: MessageSenderPort = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const mockLLM: LLMPort = { generateResponse: vi.fn().mockResolvedValue({ text: 'Hello back!' }) };
    const mockRegistry: PluginRegistryPort = { getAvailablePlugins: vi.fn().mockReturnValue([]), executePlugin: vi.fn() };

    const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry);
    
    await useCase.execute({ id: '1', userId: 'user1', content: 'Hi', timestamp: new Date() });

    expect(mockLLM.generateResponse).toHaveBeenCalled();
    expect(mockSender.sendMessage).toHaveBeenCalledWith('user1', 'Hello back!');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/use-cases/ProcessIncomingMessage.test.ts`
Expected: FAIL (Cannot find module)

- [ ] **Step 3: Write minimal implementation**

Create `src/core/use-cases/ProcessIncomingMessage.ts`:
```typescript
import { Message } from '../entities/Message';
import { MessageSenderPort } from '../ports/MessageSenderPort';
import { LLMPort } from '../ports/LLMPort';
import { PluginRegistryPort } from '../ports/PluginRegistryPort';

export class ProcessIncomingMessage {
  constructor(
    private sender: MessageSenderPort,
    private llm: LLMPort,
    private registry: PluginRegistryPort
  ) {}

  async execute(message: Message): Promise<void> {
    const plugins = this.registry.getAvailablePlugins();
    // In future: fetch history from ChatRepository here
    const history: Message[] = []; 
    
    const response = await this.llm.generateResponse(history, message, plugins);

    if (response.toolCall) {
      const toolResult = await this.registry.executePlugin(response.toolCall.name, response.toolCall.arguments);
      // Send tool result back to user for now (later, pass back to LLM for formatting)
      await this.sender.sendMessage(message.userId, toolResult);
    } else if (response.text) {
      await this.sender.sendMessage(message.userId, response.text);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/use-cases/ProcessIncomingMessage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core tests/core
git commit -m "feat(core): implement ProcessIncomingMessage use case"
```

---

### Task 4: CLI Adapter

**Files:**
- Create: `src/adapters/driving/cli/CLIAdapter.ts`
- Create: `src/index.ts`

**Interfaces:**
- Consumes: `ProcessIncomingMessage`

- [ ] **Step 1: Write CLI implementation**

Create `src/adapters/driving/cli/CLIAdapter.ts`:
```typescript
import * as readline from 'readline';
import { ProcessIncomingMessage } from '../../../core/use-cases/ProcessIncomingMessage';

export class CLIAdapter {
  private rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  constructor(private processMessageUseCase: ProcessIncomingMessage) {}

  start() {
    console.log("Iny CLI started. Type your message (or 'exit' to quit):");
    this.prompt();
  }

  private prompt() {
    this.rl.question('> ', async (input) => {
      if (input.trim().toLowerCase() === 'exit') {
        this.rl.close();
        return;
      }

      await this.processMessageUseCase.execute({
        id: Date.now().toString(),
        userId: 'cli-user',
        content: input,
        timestamp: new Date()
      });

      this.prompt();
    });
  }
}
```

- [ ] **Step 2: Create Index for wiring (Mocking driven adapters for now)**

Create `src/index.ts`:
```typescript
import { ProcessIncomingMessage } from './core/use-cases/ProcessIncomingMessage';
import { CLIAdapter } from './adapters/driving/cli/CLIAdapter';

const mockSender = {
  sendMessage: async (userId: string, text: string) => { console.log(`\n[Iny -> ${userId}]: ${text}\n`); }
};

const mockLLM = {
  generateResponse: async () => ({ text: "I am a mock LLM." })
};

const mockRegistry = {
  getAvailablePlugins: () => [],
  executePlugin: async () => ""
};

const useCase = new ProcessIncomingMessage(mockSender, mockLLM, mockRegistry);
const cli = new CLIAdapter(useCase);
cli.start();
```

- [ ] **Step 3: Run the CLI**

Run: `npx ts-node src/index.ts`
Action: Type a message, verify you get "I am a mock LLM." back, then type 'exit'.

- [ ] **Step 4: Commit**

```bash
git add src/adapters/driving src/index.ts
git commit -m "feat(cli): add CLI driving adapter"
```
