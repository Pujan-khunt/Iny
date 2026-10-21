import { z } from 'zod';
import { Tool, ToolDefinition, ToolResult } from '../core/ports/ToolRegistryPort';

/**
 * Base abstract class for declarative tool implementations.
 * Provides schema validation and JSON schema extraction via Zod.
 */
export abstract class BaseTool<TSchema extends z.ZodType> implements Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly schema: TSchema & Record<string, unknown>;

  get definition(): ToolDefinition {
    const jsonSchema = z.toJSONSchema(this.schema) as Record<string, unknown>;
    return {
      name: this.name,
      description: this.description,
      schema: jsonSchema,
    };
  }


  /**
   * Executes the tool with schema validation.
   *
   * Note on error handling: When argument validation fails, this method returns
   * a formatted error ToolResult (isTerminal: false) instead of throwing an exception.
   * This string is sent back as the tool call execution response in a ToolResultMessage.
   * The LLM automatically inspects this feedback to self-correct in the next reasoning iteration.
   */
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const parsed = this.schema.safeParse(args);
    if (!parsed.success) {
      return {
        content: `Error: Invalid tool arguments: ${z.prettifyError(parsed.error)}`,
        isTerminal: false,
      };
    }
    return this.run(parsed.data);
  }

  /**
   * Template hook implemented by concrete tools to perform business logic.
   * Subclasses receive strongly-typed, pre-validated arguments inferred from the schema.
   */
  protected abstract run(args: z.infer<TSchema>): Promise<ToolResult>;
}
