import { z } from 'zod';
import { Tool, ToolDefinition } from '../core/ports/ToolRegistryPort';

/**
 * Base abstract class for declarative tool implementations.
 * Provides schema validation and JSON schema extraction via Zod.
 */
export abstract class BaseTool<TSchema extends z.ZodType> implements Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly schema: TSchema & Record<string, unknown>;

  get definition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      schema: z.toJSONSchema(this.schema) as Record<string, unknown>,
    };
  }

  /**
   * Executes the tool with schema validation.
   *
   * Note on error handling: When argument validation fails, this method returns
   * a formatted error string instead of throwing an exception. This string is
   * sent back as the tool call execution response in a ToolMessage. The LLM
   * automatically inspects this feedback to determine whether the execution
   * succeeded or failed due to invalid arguments from its side, allowing it to
   * self-correct in the next reasoning iteration.
   */
  async execute(args: Record<string, unknown>): Promise<string> {
    const parsed = this.schema.safeParse(args);
    if (!parsed.success) {
      return `Error: Invalid tool arguments: ${z.prettifyError(parsed.error)}`;
    }
    return this.run(parsed.data);
  }

  /**
   * Template hook implemented by concrete tools to perform business logic.
   * Subclasses receive strongly-typed, pre-validated arguments inferred from the schema.
   */
  protected abstract run(args: z.infer<TSchema>): Promise<string>;
}
