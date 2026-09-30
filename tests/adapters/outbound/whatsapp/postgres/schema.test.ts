import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { whatsappAuth } from '../../../../../src/adapters/outbound/whatsapp/postgres/schema';

describe('whatsappAuth Drizzle Schema', () => {
  it('should define the table with the correct name and columns', () => {
    const config = getTableConfig(whatsappAuth);
    expect(config.name).toBe('whatsapp_auth');

    const columns = getTableColumns(whatsappAuth);
    expect(columns.sessionId).toBeDefined();
    expect(columns.key).toBeDefined();
    expect(columns.value).toBeDefined();
    expect(columns.updatedAt).toBeDefined();

    expect(columns.sessionId.notNull).toBe(true);
    expect(columns.sessionId.default).toBe('default');
    expect(columns.key.notNull).toBe(true);
    expect(columns.value.notNull).toBe(true);
    expect(columns.updatedAt.notNull).toBe(true);
  });

  it('should define a composite primary key on (sessionId, key)', () => {
    const config = getTableConfig(whatsappAuth);
    expect(config.primaryKeys.length).toBe(1);
    const pk = config.primaryKeys[0];
    const columnNames = pk.columns.map((col) => col.name);
    expect(columnNames).toEqual(['session_id', 'key']);
  });
});
