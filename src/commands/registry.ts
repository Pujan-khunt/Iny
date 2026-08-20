import type { Command } from "./types.js";

export interface CommandRegistry {
  register: (command: Command) => void;
  get: (name: string) => Command | undefined;
  list: () => Command[];
}

export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, Command>();

  function register(command: Command) {
    commands.set(command.name, command);

    for (const alias of command.aliases ?? []) {
      commands.set(alias, command);
    }
  }

  function get(name: string): Command | undefined {
    return commands.get(name.toLowerCase());
  }

  function list(): Command[] {
    return [...new Set(commands.values())];
  }

  return { register, get, list };
}