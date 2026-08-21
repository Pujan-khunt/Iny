import { allowCommand, allowlistCommand, disallowCommand } from "./admin.js";
import { helpCommand } from "./help.js";
import { createCommandRegistry } from "./registry.js";
import type { CommandRegistry } from "./registry.js";

export function createCommands(): CommandRegistry {
  const registry = createCommandRegistry();

  registry.register(helpCommand);
  registry.register(allowCommand);
  registry.register(disallowCommand);
  registry.register(allowlistCommand);

  return registry;
}