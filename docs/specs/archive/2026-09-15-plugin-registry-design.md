# Plugin Registry & Calculator Plugin Design

## 1. Overview
This document specifies the design for the **Plugin Registry** and an initial **Calculator Plugin** in Iny. The Plugin Registry serves as the driven adapter implementing `PluginRegistryPort`. It manages active tool plugins, exposes their schemas to the core use case for LLM tool selection, and dispatches tool execution calls to the appropriate plugin.

## 2. Architecture & File Structure
Following Hexagonal Architecture, the registry is a driven adapter living outside the core domain, while individual plugins are standalone action modules.

```text
src/
├── adapters/
│   └── driven/
│       └── plugin-registry/
│           └── InMemoryPluginRegistry.ts      # Implements PluginRegistryPort
├── core/
│   └── ports/
│       └── PluginRegistryPort.ts              # Existing domain port & Plugin interface
├── plugins/
│   └── CalculatorPlugin.ts                    # Implements Plugin interface
└── index.ts                                   # Application composition root
```

## 3. Interfaces & Contracts
From `src/core/ports/PluginRegistryPort.ts`:
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

## 4. Component Details

### 4.1. `InMemoryPluginRegistry`
- **File:** `src/adapters/driven/plugin-registry/InMemoryPluginRegistry.ts`
- **Responsibilities:**
  - Implements `PluginRegistryPort`.
  - Maintains an internal collection of registered plugins via `Map<string, Plugin>`.
  - `register(plugin: Plugin): void`:
    - Registers a plugin under `plugin.name`.
    - Throws an `Error` if a plugin with the same name is already registered to prevent silent overwrites.
  - `getAvailablePlugins(): Plugin[]`:
    - Returns an array of all currently registered `Plugin` instances.
  - `executePlugin(name: string, args: any): Promise<string>`:
    - Looks up the plugin by `name`.
    - If no plugin matches `name`, returns a defensive error string: `'Error: Tool "${name}" not found.'`.
    - Executes `plugin.execute(args)` inside a `try/catch` block.
    - If execution succeeds, returns the string result.
    - If execution throws, logs the error via `console.error` and returns `'Error executing ${name}: ${error.message}'`.

### 4.2. `CalculatorPlugin`
- **File:** `src/plugins/CalculatorPlugin.ts`
- **Responsibilities:**
  - Implements `Plugin`.
  - Serves as a lightweight verification plugin to validate LLM tool calling end-to-end.
- **Specification:**
  - `name`: `'calculate'`
  - `description`: `'Evaluates a basic mathematical expression (e.g. "2 + 2", "15 * 3 - 4")'`
  - `schema`:
    ```json
    {
      "type": "object",
      "properties": {
        "expression": {
          "type": "string",
          "description": "The math expression to calculate"
        }
      },
      "required": ["expression"]
    }
    ```
- **Execution & Safety:**
  - Validates that `args.expression` is a non-empty string.
  - Validates that the expression contains only numbers, whitespace, and basic arithmetic operators: `^[0-9+\-*/().\s]+$`.
  - If invalid characters are present, returns `'Error: Expression contains invalid characters.'`.
  - Safely evaluates arithmetic expressions using operator precedence without raw `eval()` code execution hazards.
  - Guards against division by zero, returning `'Error: Division by zero.'` if encountered.
  - Returns the computed result as a string (e.g. `'42'`).

## 5. Application Wiring (`src/index.ts`)
In `src/index.ts`:
1. Instantiate `InMemoryPluginRegistry`.
2. Instantiate and register `CalculatorPlugin`:
   ```typescript
   const registry = new InMemoryPluginRegistry();
   registry.register(new CalculatorPlugin());
   ```
3. Pass `registry` into `ProcessIncomingMessage` in place of the temporary `mockRegistry`.

## 6. Testing Strategy

### 6.1. Unit Tests for `InMemoryPluginRegistry`
- **File:** `tests/adapters/driven/plugin-registry/InMemoryPluginRegistry.test.ts`
- **Test cases:**
  - Registers plugins and returns them in `getAvailablePlugins()`.
  - Throws when registering duplicate plugin names.
  - Dispatches `executePlugin` to the correct plugin with passed arguments.
  - Returns defensive error string when attempting to execute an unknown plugin.
  - Returns defensive error string when a plugin's `.execute()` throws an error.

### 6.2. Unit Tests for `CalculatorPlugin`
- **File:** `tests/plugins/CalculatorPlugin.test.ts`
- **Test cases:**
  - Correctly defines `name`, `description`, and `schema`.
  - Evaluates basic operations (`+`, `-`, `*`, `/`, operator precedence, parentheses).
  - Handles floating point operations and negative numbers.
  - Rejects expressions with letters or disallowed characters.
  - Rejects division by zero gracefully.
  - Handles missing or empty expression arguments gracefully.
