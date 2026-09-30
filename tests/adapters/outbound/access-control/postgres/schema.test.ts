import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { allowedUsers } from '../../../../../src/adapters/outbound/access-control/postgres/schema';

describe('allowedUsers Drizzle Schema', () => {
  it('should define the table with the correct name and columns', () => {
    const config = getTableConfig(allowedUsers);
    expect(config.name).toBe('allowed_users');

    const columns = getTableColumns(allowedUsers);
    expect(columns.phoneNumber).toBeDefined();
    expect(columns.jid).toBeDefined();
    expect(columns.lid).toBeDefined();
    expect(columns.name).toBeDefined();
    expect(columns.role).toBeDefined();
    expect(columns.isActive).toBeDefined();
    expect(columns.createdAt).toBeDefined();
    expect(columns.updatedAt).toBeDefined();

    expect(columns.phoneNumber.primary).toBe(true);
    expect(columns.phoneNumber.notNull).toBe(true);
    expect(columns.jid.notNull).toBe(true);
    expect(columns.lid.notNull).toBe(false);
    expect(columns.role.notNull).toBe(true);
    expect(columns.role.default).toBe('user');
    expect(columns.isActive.notNull).toBe(true);
    expect(columns.isActive.default).toBe(true);
    expect(columns.createdAt.notNull).toBe(true);
    expect(columns.updatedAt.notNull).toBe(true);
  });

  it('should define unique indexes on jid and lid', () => {
    const config = getTableConfig(allowedUsers);
    const indexNames = config.indexes.map((idx) => idx.config.name);
    expect(indexNames).toContain('idx_allowed_users_jid');
    expect(indexNames).toContain('idx_allowed_users_lid');
    expect(indexNames).toContain('idx_allowed_users_is_active');
  });

  it('should define check constraints for phone digits and role', () => {
    const config = getTableConfig(allowedUsers);
    const checkNames = config.checks.map((chk) => chk.name);
    expect(checkNames).toContain('chk_allowed_users_phone_digits');
    expect(checkNames).toContain('chk_allowed_users_role');
  });
});
