import { echoCommand } from "./echo.js";
import { helpCommand } from "./help.js";
import { pingCommand } from "./ping.js";
import { createCommandRegistry } from "./registry.js";
import type { CommandRegistry } from "./registry.js";

export function createCommands(): CommandRegistry {
  const registry = createCommandRegistry();

  registry.register(pingCommand);
  registry.register(echoCommand);
  registry.register(helpCommand);

  return registry;
}