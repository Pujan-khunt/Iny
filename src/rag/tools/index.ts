/**
 * Tool Registration
 *
 * Creates and populates the ToolRegistry with all available tools.
 * To add a new tool:
 *   1. Create a class implementing Tool in src/rag/tools/
 *   2. Import and register it here
 */

import { ToolRegistry } from "../tool.js";
import { SearchPolicyTool } from "./searchPolicy.js";

export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register(new SearchPolicyTool());

  return registry;
}
