import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAgent, executeToolCallWithRetry } from "./agent.js";
import type { AgentDeps } from "./agent.js";
import type { ToolRegistry } from "../rag/tool.js";

describe("agent", () => {
  let mockClient: any;
  let registry: ToolRegistry;
  let deps: AgentDeps;

  beforeEach(() => {
    mockClient = {
      chat: {
        completions: {
          create: vi.fn()
        }
      }
    };
    registry = {
      get: vi.fn(),
      schemas: vi.fn().mockReturnValue([])
    } as unknown as ToolRegistry;
    deps = {
      client: mockClient as any,
      config: { maxIterations: 3, retryAttempts: 2, retryBaseDelay: 1 }
    };
  });

  it("executeAgent returns final answer when LLM responds without tool calls", async () => {
    mockClient.chat.completions.create.mockResolvedValue({
      choices: [{
        message: { content: "final answer", tool_calls: [] },
        finish_reason: "stop"
      }]
    });

    const agent = createAgent(deps);
    const result = await agent.executeAgent("hello", [], registry);
    expect(result.message).toBe("final answer");
    expect(result.iterations).toBe(1);
    expect(result.sources).toEqual([]);
  });

  it("executeAgent executes tools and collects sources", async () => {
    mockClient.chat.completions.create
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "test_tool", arguments: "{}" }
            }]
          }
        }]
      })
      .mockResolvedValueOnce({
        choices: [{
          message: { content: "done with tool", tool_calls: [] }
        }]
      });

    const mockTool = {
      execute: vi.fn().mockResolvedValue({
        content: '{"success":true}',
        chunks: [{ id: "c1", title: "t1", content: "c", pageStart: 1, pageEnd: 1 }]
      })
    };
    (registry.get as any).mockReturnValue(mockTool);

    const agent = createAgent(deps);
    const result = await agent.executeAgent("use tool", [], registry);
    expect(result.message).toBe("done with tool");
    expect(result.iterations).toBe(2);
    expect(result.sources.length).toBe(1);
  });

  it("executeAgent returns fallback after max iterations", async () => {
    mockClient.chat.completions.create.mockResolvedValue({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "call_loop",
            type: "function",
            function: { name: "test_tool", arguments: "{}" }
          }]
        }
      }]
    });

    const mockTool = {
      execute: vi.fn().mockResolvedValue({
        content: '{"success":true}',
        chunks: []
      })
    };
    (registry.get as any).mockReturnValue(mockTool);

    const agent = createAgent(deps);
    const result = await agent.executeAgent("loop", [], registry);
    expect(result.iterations).toBe(3);
    expect(result.message).toContain("I don't have that information");
  });

  it("executeAgent handles LLM errors gracefully", async () => {
    mockClient.chat.completions.create.mockRejectedValue(new Error("API Error"));
    const agent = createAgent(deps);
    const result = await agent.executeAgent("error", [], registry);
    expect(result.message).toContain("trouble processing your request");
  });

  describe("executeToolCallWithRetry", () => {
    it("retries on failure", async () => {
      const mockTool = {
        execute: vi.fn()
          .mockRejectedValueOnce(new Error("fail1"))
          .mockResolvedValueOnce({ content: "success", chunks: [] })
      };
      (registry.get as any).mockReturnValue(mockTool);

      const tc = { id: "1", type: "function" as const, function: { name: "test", arguments: "{}" } };
      const res = await executeToolCallWithRetry(tc, registry, 2, 1);
      expect(res.content).toBe("success");
      expect(mockTool.execute).toHaveBeenCalledTimes(2);
    });

    it("returns error result after all retries exhausted", async () => {
      const mockTool = {
        execute: vi.fn().mockRejectedValue(new Error("fail always"))
      };
      (registry.get as any).mockReturnValue(mockTool);

      const tc = { id: "1", type: "function" as const, function: { name: "test", arguments: "{}" } };
      const res = await executeToolCallWithRetry(tc, registry, 2, 1);
      expect(res.content).toContain("fail always");
      expect(mockTool.execute).toHaveBeenCalledTimes(2);
    });

    it("returns error for unknown tool", async () => {
      (registry.get as any).mockReturnValue(undefined);

      const tc = { id: "1", type: "function" as const, function: { name: "unknown", arguments: "{}" } };
      const res = await executeToolCallWithRetry(tc, registry, 1, 1);
      expect(res.content).toContain("Unknown tool: unknown");
    });
  });
});
