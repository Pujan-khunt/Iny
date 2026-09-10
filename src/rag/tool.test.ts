import { describe, it, expect } from "vitest";
import { ToolRegistry, type Tool } from "./tool.js";

const createMockTool = (name: string): Tool => ({
  name,
  description: `Desc ${name}`,
  parameters: { type: "object", properties: {} },
  execute: async () => ({ content: "res", chunks: [] })
});

describe("ToolRegistry", () => {
  it("register and get by name", () => {
    const reg = new ToolRegistry();
    const t = createMockTool("tool1");
    reg.register(t);
    expect(reg.get("tool1")).toBe(t);
  });

  it("get returns undefined for unknown name", () => {
    const reg = new ToolRegistry();
    expect(reg.get("unknown")).toBeUndefined();
  });

  it("register throws on duplicate name", () => {
    const reg = new ToolRegistry();
    const t = createMockTool("t1");
    reg.register(t);
    expect(() => reg.register(t)).toThrow("Tool already registered: t1");
  });

  it("names() returns all registered names", () => {
    const reg = new ToolRegistry();
    reg.register(createMockTool("t1"));
    reg.register(createMockTool("t2"));
    expect(reg.names()).toEqual(["t1", "t2"]);
  });

  it("schemas() returns OpenAI-compatible tool schemas", () => {
    const reg = new ToolRegistry();
    const t = createMockTool("t1");
    reg.register(t);
    const schemas = reg.schemas();
    expect(schemas).toHaveLength(1);
    expect(schemas[0]).toEqual({
      type: "function",
      function: {
        name: "t1",
        description: "Desc t1",
        parameters: { type: "object", properties: {} },
      }
    });
  });
  
  it("Register multiple tools and verify all are retrievable", () => {
    const reg = new ToolRegistry();
    reg.register(createMockTool("t1"));
    reg.register(createMockTool("t2"));
    reg.register(createMockTool("t3"));
    expect(reg.get("t1")?.name).toBe("t1");
    expect(reg.get("t2")?.name).toBe("t2");
    expect(reg.get("t3")?.name).toBe("t3");
  });
});
