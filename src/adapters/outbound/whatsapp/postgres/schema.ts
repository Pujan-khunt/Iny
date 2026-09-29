import { pgTable, varchar, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';

export const whatsappAuth = pgTable(
  'whatsapp_auth',
  {
    sessionId: varchar('session_id', { length: 128 }).notNull().default('default'),
    key: varchar('key', { length: 255 }).notNull(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.key] }),
  ]
);

export type WhatsappAuthRow = typeof whatsappAuth.$inferSelect;
export type NewWhatsappAuthRow = typeof whatsappAuth.$inferInsert;
