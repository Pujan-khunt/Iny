import { describe, it, expect } from "vitest";
import { createCommandRegistry } from "./registry.js";
import type { Command } from "./types.js";

describe("createCommandRegistry", () => {
  it("registers and gets command by name", () => {
    const registry = createCommandRegistry();
    const cmd: Command = { name: "test", execute: async () => {} };
    registry.register(cmd);
    expect(registry.get("test")).toBe(cmd);
  });

  it("gets with aliases works", () => {
    const registry = createCommandRegistry();
    const cmd: Command = { name: "test", aliases: ["t", "tst"], execute: async () => {} };
    registry.register(cmd);
    expect(registry.get("t")).toBe(cmd);
    expect(registry.get("tst")).toBe(cmd);
  });

  it("get returns undefined for unknown", () => {
    const registry = createCommandRegistry();
    expect(registry.get("unknown")).toBeUndefined();
  });

  it("list() returns unique commands", () => {
    const registry = createCommandRegistry();
    const cmd: Command = { name: "test", aliases: ["t"], execute: async () => {} };
    registry.register(cmd);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]).toBe(cmd);
  });

  it("case insensitive get", () => {
    const registry = createCommandRegistry();
    const cmd: Command = { name: "TeSt", execute: async () => {} };
    registry.register(cmd);
    expect(registry.get("TEST")).toBe(cmd);
    expect(registry.get("test")).toBe(cmd);
  });
});
