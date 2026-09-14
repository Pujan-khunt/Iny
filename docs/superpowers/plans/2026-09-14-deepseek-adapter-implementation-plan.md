# Deepseek Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Deepseek Adapter using the `openai` SDK, implement Zod validation for native environment variables, and update the core Use Case to manage the bot's persona.

**Architecture:** Hexagonal Architecture. The new adapter implements `LLMPort` and injects into the core without the core knowing it's Deepseek.

**Tech Stack:** Node.js, TypeScript, Vitest, Zod, `openai` (NPM package for Deepseek compatibility).

**Spec:** `docs/superpowers/specs/2026-09-14-deepseek-adapter-design.md`

## Global Constraints

- Node.js runtime environment with native `--env-file` support.
- Strict TypeScript (`"strict": true`).
- No external imports in `src/core`.
- Commits must follow Conventional Commits.

---

### Task 1: Configuration & Zod Setup

**Files:**
- Create: `src/config.ts`
- Create: `.env.example`
- Create: `tests/config.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `config` object with validated `DEEPSEEK_API_KEY`.

- [ ] **Step 1: Install Zod**

```bash
npm install zod
```

- [ ] **Step 2: Create the test file for config**

Create `tests/config.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should throw if DEEPSEEK_API_KEY is missing', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    await expect(import('../src/config')).rejects.toThrow();
  });

  it('should export config if DEEPSEEK_API_KEY is present', async () => {
    process.env.DEEPSEEK_API_KEY = 'test_key';
    const { config } = await import('../src/config');
    expect(config.DEEPSEEK_API_KEY).toBe('test_key');
  });
});
```

- [ ] **Step 3: Implement Config with Zod**

Create `src/config.ts`:
```typescript
import { z } from 'zod';

const envSchema = z.object({
  DEEPSEEK_API_KEY: z.string().min(1, 'DEEPSEEK_API_KEY is required'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:', parsedEnv.error.format());
  process.exit(1);
}

export const config = parsedEnv.data;
```

Create `.env.example`:
```
DEEPSEEK_API_KEY=your_key_here
```

- [ ] **Step 4: Update start script**

Update `package.json` to use the native env-file flag. Replace the `"start"` script (or add it if missing):
```json
"scripts": {
  "start": "ts-node --env-file=.env src/index.ts",
  "test": "vitest run"
}
```

- [ ] **Step 5: Run tests and commit**

Run: `npm run test`
Expected: PASS

```bash
git add package.json src/config.ts tests/config.test.ts .env.example
git commit -m "feat(config): add zod environment validation"
```

---

### Task 2: Core Modifications (Persona)

**Files:**
- Modify: `src/core/ports/LLMPort.ts`
- Modify: `src/core/use-cases/ProcessIncomingMessage.ts`
- Modify: `tests/core/use-cases/ProcessIncomingMessage.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `LLMPort`
- Produces: Updated `generateResponse` signature expecting a system prompt.

- [ ] **Step 1: Update the LLMPort**

Modify `src/core/ports/LLMPort.ts` to add `systemPrompt: string` as the first argument:
```typescript
export interface LLMPort {
  generateResponse(systemPrompt: string, history: Message[], newMessage: Message, plugins: Plugin[]): Promise<LLMResponse>;
}
```

- [ ] **Step 2: Fix the tests**

Modify `tests/core/use-cases/ProcessIncomingMessage.test.ts` to expect the new signature. Change the expectation to verify the persona:
```typescript
// Replace the old expect with this:
expect(mockLLM.generateResponse).toHaveBeenCalledWith(
  expect.stringContaining('You are Iny'),
  [],
  expect.objectContaining({ content: 'Hi' }),
  []
);
```

- [ ] **Step 3: Update ProcessIncomingMessage**

Modify `src/core/use-cases/ProcessIncomingMessage.ts` to pass the prompt:
```typescript
// Update the execute method to pass the persona
const systemPrompt = "You are Iny, a friendly and highly concise assistant for college students. Never use emojis and keep answers under 2 sentences.";
const response = await this.llm.generateResponse(systemPrompt, history, message, plugins);
```

- [ ] **Step 4: Update Mock in Index**

Modify `src/index.ts` to match the new signature:
```typescript
const mockLLM = {
  generateResponse: async (systemPrompt: string, history: any[], newMessage: any, plugins: any[]) => ({ text: "I am a mock LLM." })
};
```

- [ ] **Step 5: Run tests and commit**

Run: `npm run test`
Expected: PASS

```bash
git add src/core tests/core src/index.ts
git commit -m "feat(core): inject persona via LLMPort"
```

---

### Task 3: Deepseek Adapter Implementation

**Files:**
- Create: `src/adapters/driven/llm/DeepseekAdapter.ts`
- Create: `tests/adapters/driven/llm/DeepseekAdapter.test.ts`

**Interfaces:**
- Consumes: `LLMPort`, `PluginRegistryPort`, `config`
- Produces: A concrete class `DeepseekAdapter` using OpenAI SDK.

- [ ] **Step 1: Install OpenAI**

```bash
npm install openai
```

- [ ] **Step 2: Write adapter tests (Mocking OpenAI)**

Create `tests/adapters/driven/llm/DeepseekAdapter.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { DeepseekAdapter } from '../../../../src/adapters/driven/llm/DeepseekAdapter';
import OpenAI from 'openai';

vi.mock('openai', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'Mock response' } }]
  });
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } }
    }))
  };
});

describe('DeepseekAdapter', () => {
  it('should generate text response', async () => {
    const adapter = new DeepseekAdapter('fake_key');
    const response = await adapter.generateResponse('System prompt', [], { id: '1', userId: 'u1', content: 'Hello', timestamp: new Date() }, []);
    
    expect(response.text).toBe('Mock response');
    expect(response.toolCall).toBeUndefined();
  });
});
```

- [ ] **Step 3: Implement the Adapter**

Create `src/adapters/driven/llm/DeepseekAdapter.ts`:
```typescript
import OpenAI from 'openai';
import { LLMPort, LLMResponse } from '../../../core/ports/LLMPort';
import { Message } from '../../../core/entities/Message';
import { Plugin } from '../../../core/ports/PluginRegistryPort';

export class DeepseekAdapter implements LLMPort {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com',
    });
  }

  async generateResponse(systemPrompt: string, history: Message[], newMessage: Message, plugins: Plugin[]): Promise<LLMResponse> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history.map(msg => ({ role: 'user' as const, content: msg.content })),
      { role: 'user', content: newMessage.content }
    ];

    const tools = plugins.length > 0 ? plugins.map(p => ({
      type: 'function' as const,
      function: {
        name: p.name,
        description: p.description,
        parameters: p.schema
      }
    })) : undefined;

    const response = await this.client.chat.completions.create({
      model: 'deepseek-flash',
      messages,
      tools,
      tool_choice: tools ? 'auto' : undefined
    });

    const responseMessage = response.choices[0].message;

    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      const toolCall = responseMessage.tool_calls[0].function;
      return {
        toolCall: {
          name: toolCall.name,
          arguments: JSON.parse(toolCall.arguments)
        }
      };
    }

    return { text: responseMessage.content || '' };
  }
}
```

- [ ] **Step 4: Run tests and commit**

Run: `npm run test`
Expected: PASS

```bash
git add package.json package-lock.json src/adapters/driven/llm tests/adapters/driven/llm
git commit -m "feat(llm): implement DeepseekAdapter using openai sdk"
```

---

### Task 4: Integrate Adapter

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `DeepseekAdapter`, `config`

- [ ] **Step 1: Wire it up**

Modify `src/index.ts` to replace `mockLLM` with the real adapter. Add the imports at the top:
```typescript
import { config } from './config';
import { DeepseekAdapter } from './adapters/driven/llm/DeepseekAdapter';

// Replace the mockLLM definition with:
const deepseekAdapter = new DeepseekAdapter(config.DEEPSEEK_API_KEY);

// Pass it to the use case:
const useCase = new ProcessIncomingMessage(mockSender, deepseekAdapter, mockRegistry);
```

- [ ] **Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: integrate real DeepseekAdapter into application"
```
