import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { Message } from '../../../../core/entities/Message';

export const dialogueTurns = pgTable(
  'dialogue_turns',
  {
    id: uuid('id').primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    userQuery: text('user_query').notNull(),
    assistantResponse: text('assistant_response').notNull(),
    toolNames: text('tool_names')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
    durationMs: integer('duration_ms').generatedAlwaysAs(
      sql`ROUND(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::integer`
    ),
    messages: jsonb('messages').$type<Message[]>().notNull(),
  },
  (table) => [
    index('idx_dialogue_turns_user_completed').on(table.userId, table.completedAt.desc()),
  ]
);

export type DialogueTurnRow = typeof dialogueTurns.$inferSelect;
export type NewDialogueTurnRow = typeof dialogueTurns.$inferInsert;
