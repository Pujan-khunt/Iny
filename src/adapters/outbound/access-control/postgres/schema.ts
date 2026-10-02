import { pgTable, text, boolean, timestamp, check, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const allowedUsers = pgTable(
  'allowed_users',
  {
    phoneNumber: text('phone_number').primaryKey(),
    pnJid: text('pn_jid').notNull(),
    lidJid: text('lid_jid'),
    name: text('name'),
    role: text('role').notNull().default('user'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_allowed_users_pn_jid').on(table.pnJid),
    uniqueIndex('idx_allowed_users_lid_jid')
      .on(table.lidJid)
      .where(sql`${table.lidJid} IS NOT NULL`),
    index('idx_allowed_users_is_active').on(table.isActive),
    check('chk_allowed_users_phone_digits', sql`${table.phoneNumber} ~ '^[0-9]+$'`),
    check('chk_allowed_users_role', sql`${table.role} IN ('admin', 'user')`),
  ]
);
