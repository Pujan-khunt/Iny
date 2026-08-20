import { allowCommand, allowlistCommand, disallowCommand } from "./admin.js";
import { askCommand, forgetCommand, memoryCommand, rememberCommand } from "./ask.js";
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
  registry.register(askCommand);
  registry.register(rememberCommand);
  registry.register(memoryCommand);
  registry.register(forgetCommand);
  registry.register(allowCommand);
  registry.register(disallowCommand);
  registry.register(allowlistCommand);

  return registry;
}