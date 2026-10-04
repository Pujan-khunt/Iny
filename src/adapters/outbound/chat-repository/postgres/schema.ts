import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
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
    reasoning: text('reasoning')
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
    check('chk_dialogue_turns_timing', sql`${table.completedAt} >= ${table.startedAt}`),
    check(
      'chk_dialogue_turns_messages',
      sql`jsonb_array_length(${table.messages}) >= 2 AND (${table.messages}->0->>'role') = 'user' AND (${table.messages}->-1->>'role') = 'assistant' AND (${table.messages}->-1->'toolCalls') IS NULL`
    ),
  ]
);

export type DialogueTurnRow = typeof dialogueTurns.$inferSelect;
export type NewDialogueTurnRow = typeof dialogueTurns.$inferInsert;
