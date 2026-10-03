import { pgTable, text, timestamp, check, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { UserRecord, UserRole, UserStatus } from '../../../../core/ports/AccessControlPort';

export const users = pgTable(
  'users',
  {
    phoneNumber: text('phone_number').primaryKey(),
    pnJid: text('pn_jid').notNull(),
    lidJid: text('lid_jid'),
    name: text('name'),
    role: text('role').$type<UserRole>().notNull().default('user'),
    status: text('status').$type<UserStatus>().notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_users_pn_jid').on(table.pnJid),
    uniqueIndex('idx_users_lid_jid')
      .on(table.lidJid)
      .where(sql`${table.lidJid} IS NOT NULL`),
    index('idx_users_status').on(table.status),
    check('chk_users_phone_digits', sql`${table.phoneNumber} ~ '^[0-9]+$'`),
    check('chk_users_role', sql`${table.role} IN ('admin', 'user')`),
    check('chk_users_status', sql`${table.status} IN ('active', 'pending', 'revoked', 'suspended')`),
  ]
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

// Compile-time static assertion ensuring the Drizzle schema strictly satisfies the core UserRecord port interface
type _AssertRowMatchesPort = UserRow extends UserRecord ? true : never;
