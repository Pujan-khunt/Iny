import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEngine } from "./engine.js";
import type { EngineDeps } from "./engine.js";
import type { ToolRegistry } from "../rag/tool.js";

describe("engine", () => {
  let deps: EngineDeps;
  
  beforeEach(() => {
    deps = {
      agent: { executeAgent: vi.fn() },
      memory: {
        getSessionHistory: vi.fn().mockReturnValue([]),
        appendTurn: vi.fn(),
        clearSessionMemory: vi.fn(),
        getSessionMemoryStats: vi.fn(),
      },
      sources: {
        cacheSources: vi.fn(),
        getSources: vi.fn().mockReturnValue([]),
        clearSources: vi.fn(),
        buildCitations: vi.fn().mockReturnValue([]),
      },
      registry: {} as ToolRegistry,
    };
  });

  it("askIny Calls agent, caches sources, appends turn, returns response", async () => {
    (deps.agent.executeAgent as any).mockResolvedValue({
      message: "response msg",
      sources: [{ id: "c1", title: "Doc", content: "text", pageStart: 1, pageEnd: 1 }],
      iterations: 1,
    });
    
    const engine = createEngine(deps);
    const response = await engine.askIny({
      sessionId: "sess-1",
      message: "hello",
    });

    expect(deps.memory.getSessionHistory).toHaveBeenCalledWith("sess-1");
    expect(deps.agent.executeAgent).toHaveBeenCalledWith("hello", [], deps.registry, "concise", undefined);
    expect(deps.sources.cacheSources).toHaveBeenCalledWith("sess-1", expect.any(Array));
    expect(deps.memory.appendTurn).toHaveBeenCalledWith("sess-1", "hello", "response msg");
    expect(deps.sources.buildCitations).toHaveBeenCalled();
    
    expect(response.message).toBe("response msg");
    expect(response.sessionId).toBe("sess-1");
  });

  it("askIny Uses selected style", async () => {
    (deps.agent.executeAgent as any).mockResolvedValue({
      message: "styled",
      sources: [],
      iterations: 1,
    });
    
    const engine = createEngine(deps);
    await engine.askIny({
      sessionId: "sess-2",
      message: "hi",
      style: "pirate",
      customStylePrompt: "talk like a pirate"
    });
    
    expect(deps.agent.executeAgent).toHaveBeenCalledWith(
      "hi", [], deps.registry, "pirate", "talk like a pirate"
    );
  });

  it("getSessionSources delegates to source cache", () => {
    const mockSources = [{ id: "c1", title: "Doc", content: "text", pageStart: 1, pageEnd: 1 }];
    (deps.sources.getSources as any).mockReturnValue(mockSources);
    
    const engine = createEngine(deps);
    const result = engine.getSessionSources("sess-3");
    expect(result).toBe(mockSources);
    expect(deps.sources.getSources).toHaveBeenCalledWith("sess-3");
  });

  it("resetSession clears memory and sources", () => {
    const engine = createEngine(deps);
    engine.resetSession("sess-4");
    expect(deps.memory.clearSessionMemory).toHaveBeenCalledWith("sess-4");
    expect(deps.sources.clearSources).toHaveBeenCalledWith("sess-4");
  });
});
