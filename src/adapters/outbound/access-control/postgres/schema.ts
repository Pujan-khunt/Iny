import { pgTable, text, boolean, timestamp, check, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const allowedUsers = pgTable(
  'allowed_users',
  {
    phoneNumber: text('phone_number').primaryKey(),
    jid: text('jid').notNull(),
    lid: text('lid'),
    name: text('name'),
    role: text('role').notNull().default('user'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_allowed_users_jid').on(table.jid),
    uniqueIndex('idx_allowed_users_lid')
      .on(table.lid)
      .where(sql`${table.lid} IS NOT NULL`),
    index('idx_allowed_users_is_active').on(table.isActive),
    check('chk_allowed_users_phone_digits', sql`${table.phoneNumber} ~ '^[0-9]+$'`),
    check('chk_allowed_users_role', sql`${table.role} IN ('admin', 'user')`),
  ]
);
