import { z } from 'zod';
import { BaseTool } from './BaseTool.js';
import { ToolResult } from '../core/ports/ToolRegistryPort.js';
import { MessRepositoryPort } from '../core/ports/MessRepositoryPort.js';
import { getISTDateString } from '../core/entities/MessMeal.js';

export const queryMessDetailsSchema = z.object({
  mealDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be ISO YYYY-MM-DD')
    .optional()
    .describe(
      'ISO calendar date in YYYY-MM-DD format. Omit to query current or upcoming meal date.'
    ),
  mealSlot: z
    .enum(['breakfast', 'lunch', 'dinner'])
    .optional()
    .describe('Optional meal slot: breakfast, lunch, or dinner.'),
  vendor: z
    .enum(['cheftalk_regular', 'cheftalk_jain', 'tcb'])
    .optional()
    .describe('Optional vendor caterer: cheftalk_regular, cheftalk_jain, or tcb.'),
});

/**
 * Conversational tool serving analytical or specific dietary questions
 * (e.g. "does lunch have paneer?", "who is serving ice cream?").
 * Returns raw structured JSON of ResolvedMealInfo with isTerminal: false.
 */
export class QueryMessDetailsTool extends BaseTool<typeof queryMessDetailsSchema> {
  readonly name = 'query_mess_details';
  readonly description =
    'Queries raw structured mess meal information (dishes, seating locations, extensions, live substitutions) for analytical dietary reasoning.';
  readonly schema = queryMessDetailsSchema as typeof queryMessDetailsSchema & Record<string, unknown>;

  constructor(
    private readonly messRepository: MessRepositoryPort,
    private readonly getCurrentTime: () => Date = () => new Date()
  ) {
    super();
  }

  protected async run(args: z.infer<typeof queryMessDetailsSchema>): Promise<ToolResult> {
    const now = this.getCurrentTime();
    const targetDate = args.mealDate ?? getISTDateString(now);

    const resolved = await this.messRepository.getResolvedMeal({
      mealDate: targetDate,
      mealSlot: args.mealSlot,
      vendor: args.vendor,
    });

    return {
      content: JSON.stringify(resolved),
      isTerminal: false,
    };
  }
}
