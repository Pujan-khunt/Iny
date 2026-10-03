import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { users } from '../../../../../src/adapters/outbound/access-control/postgres/schema';

describe('users Drizzle Schema', () => {
  it('should define the table with the correct name and columns', () => {
    const config = getTableConfig(users);
    expect(config.name).toBe('users');

    const columns = getTableColumns(users);
    expect(columns.phoneNumber).toBeDefined();
    expect(columns.pnJid).toBeDefined();
    expect(columns.lidJid).toBeDefined();
    expect(columns.name).toBeDefined();
    expect(columns.role).toBeDefined();
    expect(columns.status).toBeDefined();
    expect(columns.createdAt).toBeDefined();
    expect(columns.updatedAt).toBeDefined();

    expect(columns.phoneNumber.primary).toBe(true);
    expect(columns.phoneNumber.notNull).toBe(true);
    expect(columns.pnJid.notNull).toBe(true);
    expect(columns.lidJid.notNull).toBe(false);
    expect(columns.role.notNull).toBe(true);
    expect(columns.role.default).toBe('user');
    expect(columns.status.notNull).toBe(true);
    expect(columns.status.default).toBe('pending');
    expect(columns.createdAt.notNull).toBe(true);
    expect(columns.updatedAt.notNull).toBe(true);
  });

  it('should define unique indexes on pn_jid and lid_jid and an index on status', () => {
    const config = getTableConfig(users);
    const indexNames = config.indexes.map((idx) => idx.config.name);
    expect(indexNames).toContain('idx_users_pn_jid');
    expect(indexNames).toContain('idx_users_lid_jid');
    expect(indexNames).toContain('idx_users_status');

    const pnJidIdx = config.indexes.find((idx) => idx.config.name === 'idx_users_pn_jid');
    const lidJidIdx = config.indexes.find((idx) => idx.config.name === 'idx_users_lid_jid');
    const statusIdx = config.indexes.find((idx) => idx.config.name === 'idx_users_status');

    expect(pnJidIdx?.config.unique).toBe(true);
    expect(lidJidIdx?.config.unique).toBe(true);
    expect(lidJidIdx?.config.where).toBeDefined();
    expect(statusIdx?.config.unique).toBe(false);
  });

  it('should define check constraints for phone digits, role, and status', () => {
    const config = getTableConfig(users);
    const checkNames = config.checks.map((chk) => chk.name);
    expect(checkNames).toContain('chk_users_phone_digits');
    expect(checkNames).toContain('chk_users_role');
    expect(checkNames).toContain('chk_users_status');
  });
});
