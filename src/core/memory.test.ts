import { describe, it, expect, beforeEach } from "vitest";
import { createSessionMemoryStore } from "./memory.js";
import type { SessionMemoryStore } from "./memory.js";

describe("SessionMemoryStore", () => {
  let store: SessionMemoryStore;

  beforeEach(() => {
    store = createSessionMemoryStore({ maxMessages: 4, ttlMs: 1000 });
  });

  it("Fresh store returns empty history", () => {
    expect(store.getSessionHistory("session-1")).toEqual([]);
  });

  it("appendTurn adds user+assistant messages", () => {
    store.appendTurn("session-1", "hello", "hi there");
    const history = store.getSessionHistory("session-1");
    expect(history).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" }
    ]);
  });

  it("Sliding window trims to maxMessages", () => {
    store.appendTurn("session-1", "m1", "a1");
    store.appendTurn("session-1", "m2", "a2");
    store.appendTurn("session-1", "m3", "a3");
    
    // Total turns = 3 (6 messages). maxMessages = 4. 
    // It should keep the last 4 messages.
    const history = store.getSessionHistory("session-1");
    expect(history.length).toBe(4);
    expect(history).toEqual([
      { role: "user", content: "m2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "m3" },
      { role: "assistant", content: "a3" }
    ]);
  });

  it("clearSessionMemory removes history", () => {
    store.appendTurn("session-1", "m1", "a1");
    store.clearSessionMemory("session-1");
    expect(store.getSessionHistory("session-1")).toEqual([]);
  });

  it("Multiple sessions are independent", () => {
    store.appendTurn("s1", "m1", "a1");
    store.appendTurn("s2", "m2", "a2");
    expect(store.getSessionHistory("s1")).toEqual([
      { role: "user", content: "m1" },
      { role: "assistant", content: "a1" }
    ]);
    expect(store.getSessionHistory("s2")).toEqual([
      { role: "user", content: "m2" },
      { role: "assistant", content: "a2" }
    ]);
  });

  it("Stats reflect active sessions", () => {
    store.appendTurn("s1", "m1", "a1");
    store.appendTurn("s2", "m2", "a2");
    store.getSessionHistory("s1");
    const stats = store.getSessionMemoryStats();
    expect(stats.activeSessions).toBe(2);
    expect(stats.hits).toBeGreaterThanOrEqual(0);
    expect(stats.misses).toBeGreaterThanOrEqual(0);
  });
});
