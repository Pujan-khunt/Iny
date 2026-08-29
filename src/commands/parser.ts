import { COMMAND_PREFIX } from "../config.js";

export { COMMAND_PREFIX };

export interface ParsedCommand {
  name: string;
  args: string[];
  text: string;
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of input) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === " " && !inQuotes) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();

  if (!trimmed.startsWith(COMMAND_PREFIX)) {
    return null;
  }

  const tokens = tokenize(trimmed.slice(COMMAND_PREFIX.length));
  const [name, ...args] = tokens;

  if (!name) {
    return null;
  }

  return {
    name: name.toLowerCase(),
    args,
    text: trimmed.slice(COMMAND_PREFIX.length + name.length).trim(),
  };
}