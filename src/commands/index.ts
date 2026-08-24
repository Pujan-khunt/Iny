import { allowCommand, allowlistCommand, disallowCommand, helpCommand } from "./admin.js";
import { createCommandRegistry } from "./registry.js";
import type { CommandRegistry } from "./registry.js";

export function createCommands(): CommandRegistry {
  const registry = createCommandRegistry();

  registry.register(allowCommand);
  registry.register(disallowCommand);
  registry.register(allowlistCommand);
  registry.register(helpCommand);

  return registry;
}