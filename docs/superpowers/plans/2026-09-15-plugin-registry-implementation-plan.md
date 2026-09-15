# Plugin Registry & Calculator Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `InMemoryPluginRegistry` as a driven adapter for `PluginRegistryPort`, build a safe `CalculatorPlugin` to verify LLM tool execution, and wire them into the application entry point.

**Architecture:** Following Hexagonal Architecture, `InMemoryPluginRegistry` implements the domain's `PluginRegistryPort` in `src/adapters/driven/plugin-registry/`. Concrete tools implement the `Plugin` interface in `src/plugins/`. Both are composed at the application root in `src/index.ts`.

**Tech Stack:** TypeScript (strict mode), Node.js, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-plugin-registry-design.md`

## Global Constraints

- Strict TypeScript (`"strict": true` in `tsconfig.json`).
- Zero external imports in `src/core/`.
- No unsafe `eval()` or dynamic code execution in plugins.
- Defensive error handling: `executePlugin` returns descriptive error strings instead of throwing unhandled exceptions.
- Commits must follow Conventional Commits with an imperative, lowercase subject and a 72-character wrapped explanatory body.
- Do not automatically commit without explicit user approval.

---

### Task 1: Implement `InMemoryPluginRegistry`

**Files:**
- Create: `src/adapters/driven/plugin-registry/InMemoryPluginRegistry.ts`
- Test: `tests/adapters/driven/plugin-registry/InMemoryPluginRegistry.test.ts`

**Interfaces:**
- Consumes: `Plugin`, `PluginRegistryPort` from `src/core/ports/PluginRegistryPort.ts`
- Produces: `InMemoryPluginRegistry` implementing `PluginRegistryPort` with `register(plugin: Plugin): void`, `getAvailablePlugins(): Plugin[]`, and `executePlugin(name: string, args: any): Promise<string>`

- [ ] **Step 1: Write the failing test for `InMemoryPluginRegistry`**

Create `tests/adapters/driven/plugin-registry/InMemoryPluginRegistry.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryPluginRegistry } from '../../../../src/adapters/driven/plugin-registry/InMemoryPluginRegistry';
import { Plugin } from '../../../../src/core/ports/PluginRegistryPort';

describe('InMemoryPluginRegistry', () => {
  let registry: InMemoryPluginRegistry;

  const dummyPlugin: Plugin = {
    name: 'test_tool',
    description: 'A test tool',
    schema: { type: 'object', properties: {} },
    execute: vi.fn().mockResolvedValue('tool success result'),
  };

  beforeEach(() => {
    registry = new InMemoryPluginRegistry();
    vi.clearAllMocks();
  });

  it('should register a plugin and list it in getAvailablePlugins', () => {
    registry.register(dummyPlugin);

    const available = registry.getAvailablePlugins();
    expect(available).toHaveLength(1);
    expect(available[0]).toEqual(dummyPlugin);
  });

  it('should throw an error when registering a duplicate plugin name', () => {
    registry.register(dummyPlugin);

    expect(() => registry.register(dummyPlugin)).toThrow(
      "Plugin with name 'test_tool' is already registered."
    );
  });

  it('should execute a registered plugin with provided arguments', async () => {
    registry.register(dummyPlugin);

    const result = await registry.executePlugin('test_tool', { key: 'value' });
    expect(dummyPlugin.execute).toHaveBeenCalledWith({ key: 'value' });
    expect(result).toBe('tool success result');
  });

  it('should return a defensive error string if plugin is not found', async () => {
    const result = await registry.executePlugin('unknown_tool', {});

    expect(result).toBe('Error: Tool "unknown_tool" not found.');
  });

  it('should return a defensive error string if plugin execution throws', async () => {
    const failingPlugin: Plugin = {
      name: 'failing_tool',
      description: 'Fails on execution',
      schema: {},
      execute: vi.fn().mockRejectedValue(new Error('Internal failure')),
    };

    registry.register(failingPlugin);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await registry.executePlugin('failing_tool', {});

    expect(result).toBe('Error executing failing_tool: Internal failure');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/driven/plugin-registry/InMemoryPluginRegistry.test.ts`
Expected: FAIL ("Cannot find module .../InMemoryPluginRegistry")

- [ ] **Step 3: Implement `InMemoryPluginRegistry`**

Create `src/adapters/driven/plugin-registry/InMemoryPluginRegistry.ts`:
```typescript
import { Plugin, PluginRegistryPort } from '../../../core/ports/PluginRegistryPort';

export class InMemoryPluginRegistry implements PluginRegistryPort {
  private plugins = new Map<string, Plugin>();

  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin with name '${plugin.name}' is already registered.`);
    }
    this.plugins.set(plugin.name, plugin);
  }

  getAvailablePlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  async executePlugin(name: string, args: any): Promise<string> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      return `Error: Tool "${name}" not found.`;
    }

    try {
      return await plugin.execute(args);
    } catch (error: any) {
      console.error(`Error executing plugin '${name}':`, error);
      const message = error?.message || 'Unknown error';
      return `Error executing ${name}: ${message}`;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/driven/plugin-registry/InMemoryPluginRegistry.test.ts`
Expected: PASS (5 tests passing)

- [ ] **Step 5: Commit**

```bash
git add src/adapters/driven/plugin-registry/InMemoryPluginRegistry.ts tests/adapters/driven/plugin-registry/InMemoryPluginRegistry.test.ts
git commit -m "feat(plugins): implement InMemoryPluginRegistry adapter

Implement the in-memory plugin registry driven adapter fulfilling
PluginRegistryPort. Supports duplicate prevention, plugin enumeration,
and defensive error handling when tools fail or are not found."
```

---

### Task 2: Implement `CalculatorPlugin`

**Files:**
- Create: `src/plugins/CalculatorPlugin.ts`
- Test: `tests/plugins/CalculatorPlugin.test.ts`

**Interfaces:**
- Consumes: `Plugin` from `src/core/ports/PluginRegistryPort.ts`
- Produces: `CalculatorPlugin` implementing `Plugin`

- [ ] **Step 1: Write the failing test for `CalculatorPlugin`**

Create `tests/plugins/CalculatorPlugin.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { CalculatorPlugin } from '../../src/plugins/CalculatorPlugin';

describe('CalculatorPlugin', () => {
  const plugin = new CalculatorPlugin();

  it('should have correct metadata and schema', () => {
    expect(plugin.name).toBe('calculate');
    expect(plugin.description).toContain('mathematical expression');
    expect(plugin.schema).toEqual({
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'The math expression to calculate',
        },
      },
      required: ['expression'],
    });
  });

  it('should correctly evaluate basic arithmetic operations', async () => {
    expect(await plugin.execute({ expression: '2 + 2' })).toBe('4');
    expect(await plugin.execute({ expression: '10 - 3' })).toBe('7');
    expect(await plugin.execute({ expression: '4 * 5' })).toBe('20');
    expect(await plugin.execute({ expression: '15 / 3' })).toBe('5');
  });

  it('should respect operator precedence and parentheses', async () => {
    expect(await plugin.execute({ expression: '2 + 3 * 4' })).toBe('14');
    expect(await plugin.execute({ expression: '(2 + 3) * 4' })).toBe('20');
    expect(await plugin.execute({ expression: '10 - 2 * (3 + 1)' })).toBe('2');
  });

  it('should handle floating point numbers', async () => {
    expect(await plugin.execute({ expression: '2.5 * 2' })).toBe('5');
    expect(await plugin.execute({ expression: '7 / 2' })).toBe('3.5');
  });

  it('should reject invalid or malicious characters', async () => {
    expect(await plugin.execute({ expression: 'process.exit(1)' })).toBe(
      'Error: Expression contains invalid characters.'
    );
    expect(await plugin.execute({ expression: '2 + abc' })).toBe(
      'Error: Expression contains invalid characters.'
    );
  });

  it('should handle division by zero gracefully', async () => {
    expect(await plugin.execute({ expression: '5 / 0' })).toBe(
      'Error: Division by zero.'
    );
  });

  it('should handle missing or empty expression arguments gracefully', async () => {
    expect(await plugin.execute({})).toBe('Error: Missing expression argument.');
    expect(await plugin.execute({ expression: '' })).toBe('Error: Missing expression argument.');
    expect(await plugin.execute({ expression: '   ' })).toBe('Error: Missing expression argument.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugins/CalculatorPlugin.test.ts`
Expected: FAIL ("Cannot find module .../CalculatorPlugin")

- [ ] **Step 3: Implement `CalculatorPlugin` with safe arithmetic parsing**

Create `src/plugins/CalculatorPlugin.ts`:
```typescript
import { Plugin } from '../core/ports/PluginRegistryPort';

export class CalculatorPlugin implements Plugin {
  readonly name = 'calculate';
  readonly description = 'Evaluates a basic mathematical expression (e.g. "2 + 2", "15 * 3 - 4")';
  readonly schema = {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'The math expression to calculate',
      },
    },
    required: ['expression'],
  };

  async execute(args: any): Promise<string> {
    const expr = args?.expression;
    if (typeof expr !== 'string' || expr.trim() === '') {
      return 'Error: Missing expression argument.';
    }

    const trimmed = expr.trim();
    if (!/^[0-9+\-*/().\s]+$/.test(trimmed)) {
      return 'Error: Expression contains invalid characters.';
    }

    try {
      const result = this.evaluateArithmetic(trimmed);
      if (!Number.isFinite(result)) {
        return 'Error: Division by zero.';
      }
      return String(result);
    } catch {
      return 'Error: Invalid mathematical expression.';
    }
  }

  private evaluateArithmetic(expression: string): number {
    const tokens = this.tokenize(expression);
    let index = 0;

    const parsePrimary = (): number => {
      const token = tokens[index++];
      if (token === '(') {
        const val = parseAddSub();
        if (tokens[index++] !== ')') {
          throw new Error('Mismatched parentheses');
        }
        return val;
      }
      if (token === '-') {
        return -parsePrimary();
      }
      const num = Number(token);
      if (Number.isNaN(num)) {
        throw new Error(`Unexpected token: ${token}`);
      }
      return num;
    };

    const parseMulDiv = (): number => {
      let left = parsePrimary();
      while (index < tokens.length && (tokens[index] === '*' || tokens[index] === '/')) {
        const op = tokens[index++];
        const right = parsePrimary();
        if (op === '*') {
          left *= right;
        } else {
          if (right === 0) {
            return Infinity;
          }
          left /= right;
        }
      }
      return left;
    };

    const parseAddSub = (): number => {
      let left = parseMulDiv();
      while (index < tokens.length && (tokens[index] === '+' || tokens[index] === '-')) {
        const op = tokens[index++];
        const right = parseMulDiv();
        if (op === '+') {
          left += right;
        } else {
          left -= right;
        }
      }
      return left;
    };

    const result = parseAddSub();
    if (index < tokens.length) {
      throw new Error(`Unexpected extra token: ${tokens[index]}`);
    }
    return result;
  }

  private tokenize(expr: string): string[] {
    const tokens: string[] = [];
    const re = /\s*([0-9]+(?:\.[0-9]+)?|[+\-*/()])\s*/g;
    let match: RegExpExecArray | null;
    let lastIndex = 0;

    while ((match = re.exec(expr)) !== null) {
      tokens.push(match[1]);
      lastIndex = re.lastIndex;
    }

    if (lastIndex !== expr.length && expr.slice(lastIndex).trim() !== '') {
      throw new Error('Failed to tokenize entire expression');
    }

    return tokens;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugins/CalculatorPlugin.test.ts`
Expected: PASS (7 tests passing)

- [ ] **Step 5: Commit**

```bash
git add src/plugins/CalculatorPlugin.ts tests/plugins/CalculatorPlugin.test.ts
git commit -m "feat(plugins): implement CalculatorPlugin

Add self-contained CalculatorPlugin with safe arithmetic parser.
Handles operator precedence, parentheses, floating point numbers, and
defensive validation without dangerous eval execution."
```

---

### Task 3: Wire `InMemoryPluginRegistry` and `CalculatorPlugin` into Application

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `InMemoryPluginRegistry`, `CalculatorPlugin`
- Produces: Updated application startup with live plugin registry

- [ ] **Step 1: Update `src/index.ts`**

Replace `mockRegistry` with real `InMemoryPluginRegistry` and registered `CalculatorPlugin`:
```typescript
import { ProcessIncomingMessage } from './core/use-cases/ProcessIncomingMessage';
import { CLIAdapter } from './adapters/driving/cli/CLIAdapter';
import { config } from './config';
import { DeepseekAdapter } from './adapters/driven/llm/DeepseekAdapter';
import { InMemoryPluginRegistry } from './adapters/driven/plugin-registry/InMemoryPluginRegistry';
import { CalculatorPlugin } from './plugins/CalculatorPlugin';

const mockSender = {
  sendMessage: async (userId: string, text: string) => {
    console.log(`[Sent to ${userId}]: ${text}`);
  },
};

const registry = new InMemoryPluginRegistry();
registry.register(new CalculatorPlugin());

const deepseekAdapter = new DeepseekAdapter(config.DEEPSEEK_API_KEY);
const useCase = new ProcessIncomingMessage(mockSender, deepseekAdapter, registry);
const cli = new CLIAdapter(useCase);
cli.start();
```

- [ ] **Step 2: Run build and all tests**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected:
- `tsc`: 0 errors
- `build`: compiles `dist/` cleanly
- `vitest`: all tests pass across all suites

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire InMemoryPluginRegistry and CalculatorPlugin into app

Replace in-memory mockRegistry with the concrete InMemoryPluginRegistry
and register CalculatorPlugin at the composition root in src/index.ts."
```
