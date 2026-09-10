import { describe, it, expect } from "vitest";
import { parseCommand } from "./parser.js";
import { COMMAND_PREFIX } from "../config.js"; // Likely '/'

describe("Command Parser", () => {
  it("returns null for non-commands", () => {
    expect(parseCommand("Hello world")).toBeNull();
    expect(parseCommand("")).toBeNull();
  });

  it("returns null for prefix only", () => {
    expect(parseCommand(COMMAND_PREFIX)).toBeNull();
  });

  it("parses simple command without args", () => {
    const result = parseCommand(`${COMMAND_PREFIX}help`);
    expect(result).toEqual({
      name: "help",
      args: [],
      text: "",
    });
  });

  it("parses command with simple args", () => {
    const result = parseCommand(`${COMMAND_PREFIX}allow 919876543210`);
    expect(result).toEqual({
      name: "allow",
      args: ["919876543210"],
      text: "919876543210",
    });
  });

  it("parses command with multiple args", () => {
    const result = parseCommand(`${COMMAND_PREFIX}allow 919876543210 Pujan`);
    expect(result).toEqual({
      name: "allow",
      args: ["919876543210", "Pujan"],
      text: "919876543210 Pujan",
    });
  });

  it("handles quoted arguments correctly", () => {
    const result = parseCommand(`${COMMAND_PREFIX}allow 919876543210 "Pujan Khunt"`);
    expect(result).toEqual({
      name: "allow",
      args: ["919876543210", "Pujan Khunt"],
      text: '919876543210 "Pujan Khunt"',
    });
  });

  it("lowercases the command name", () => {
    const result = parseCommand(`${COMMAND_PREFIX}HELP`);
    expect(result?.name).toBe("help");
  });
});
