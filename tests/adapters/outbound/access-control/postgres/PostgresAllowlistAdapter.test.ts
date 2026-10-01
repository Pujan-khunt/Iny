import { describe, it, expect, beforeEach, vi } from 'vitest';
import { newDb } from 'pg-mem';
import { drizzle } from 'drizzle-orm/node-postgres';
import { PostgresAllowlistAdapter } from '../../../../../src/adapters/outbound/access-control/postgres/PostgresAllowlistAdapter';
import { LoggerPort } from '../../../../../src/core/ports/LoggerPort';

describe('PostgresAllowlistAdapter', () => {
  let memDb: any;
  let db: any;
  let adapter: PostgresAllowlistAdapter;
  let mockLogger: LoggerPort;

  beforeEach(async () => {
    memDb = newDb();
    memDb.public.none(`
      CREATE TABLE allowed_users (
        phone_number TEXT PRIMARY KEY,
        jid TEXT NOT NULL UNIQUE,
        lid TEXT UNIQUE,
        name TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const { Pool } = memDb.adapters.createPg();
    const pool = new Pool();
    const origQuery = pool.query.bind(pool);
    pool.query = async function (queryTextOrConfig: any, values: any, callback: any) {
      let isRowModeArray = false;
      if (typeof queryTextOrConfig === 'object' && queryTextOrConfig !== null) {
        if (queryTextOrConfig.rowMode === 'array') {
          isRowModeArray = true;
          delete queryTextOrConfig.rowMode;
        }
        delete queryTextOrConfig.types;
      }
      const result = await origQuery(queryTextOrConfig, values, callback);
      if (isRowModeArray && result && Array.isArray(result.rows)) {
        result.rows = result.rows.map((row: any) => Object.values(row));
      }
      return result;
    };

    db = drizzle(pool);

    mockLogger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as LoggerPort;

    adapter = new PostgresAllowlistAdapter(db, mockLogger);
  });

  it('should seed users with ON CONFLICT DO NOTHING without overwriting revocations', async () => {
    await adapter.seedUsers(['+91 9876543210', '15551234567']);
    expect(await adapter.countActiveUsers()).toBe(2);

    // Cache an LID
    await adapter.cacheLid('919876543210', '123456789012345@lid');
    const user = await adapter.getUser('919876543210');
    expect(user?.lid).toBe('123456789012345@lid');

    // Simulate database revocation
    memDb.public.none("UPDATE allowed_users SET is_active = false WHERE phone_number = '919876543210'");

    // Re-seed: must NOT un-revoke the user
    await adapter.seedUsers(['919876543210']);
    const revokedUser = await adapter.getUser('919876543210');
    expect(revokedUser?.isActive).toBe(false);
    expect(await adapter.countActiveUsers()).toBe(1);
  });

  it('should allow active users by phone number, PNJID, and cached LID', async () => {
    await adapter.seedUsers(['919876543210']);
    await adapter.cacheLid('919876543210', '987654321012345@lid');

    expect(await adapter.isAllowed('919876543210')).toBe(true);
    expect(await adapter.isAllowed('919876543210@s.whatsapp.net')).toBe(true);
    expect(await adapter.isAllowed('987654321012345@lid')).toBe(true);
    expect(await adapter.isAllowed('19999999999@s.whatsapp.net')).toBe(false);
  });

  it('should reject inactive users', async () => {
    await adapter.seedUsers(['919876543210']);
    memDb.public.none("UPDATE allowed_users SET is_active = false WHERE phone_number = '919876543210'");

    expect(await adapter.isAllowed('919876543210@s.whatsapp.net')).toBe(false);
  });

  it('should automatically cache incoming LID when previously null', async () => {
    await adapter.seedUsers(['919876543210']);
    let user = await adapter.getUser('919876543210');
    expect(user?.lid).toBeNull();

    // Check with pairedLid
    const allowed = await adapter.isAllowed('919876543210@s.whatsapp.net', '123456789012345@lid');
    expect(allowed).toBe(true);

    // Allow async cache operation to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    user = await adapter.getUser('919876543210');
    expect(user?.lid).toBe('123456789012345@lid');

    // Subsequent call should recognize the cached LID directly
    expect(await adapter.isAllowed('123456789012345@lid')).toBe(true);
  });

  it('should return false for invalid or unparseable address', async () => {
    expect(await adapter.isAllowed('')).toBe(false);
    expect(await adapter.isAllowed('   ')).toBe(false);
    expect(await adapter.isAllowed('invalid-group@g.us')).toBe(false);
  });

  it('should return null when getting a non-existent user', async () => {
    const user = await adapter.getUser('9999999999');
    expect(user).toBeNull();
  });

  it('should retrieve user by phone number, PNJID, and LID via partitioned single-index lookup', async () => {
    await adapter.seedUsers(['919876543210']);
    await adapter.cacheLid('919876543210', '987654321012345@lid');

    // 1. By raw phone number
    const userByPhone = await adapter.getUser('919876543210');
    expect(userByPhone).not.toBeNull();
    expect(userByPhone?.phoneNumber).toBe('919876543210');
    expect(userByPhone?.jid).toBe('919876543210@s.whatsapp.net');
    expect(userByPhone?.lid).toBe('987654321012345@lid');

    // 2. By PNJID with device suffix
    const userByJid = await adapter.getUser('919876543210:1@s.whatsapp.net');
    expect(userByJid).not.toBeNull();
    expect(userByJid?.phoneNumber).toBe('919876543210');

    // 3. By formatted phone number
    const userByFormatted = await adapter.getUser('+91 98765 43210');
    expect(userByFormatted).not.toBeNull();
    expect(userByFormatted?.phoneNumber).toBe('919876543210');

    // 4. By LID with device suffix
    const userByLid = await adapter.getUser('987654321012345:2@lid');
    expect(userByLid).not.toBeNull();
    expect(userByLid?.phoneNumber).toBe('919876543210');

    // 5. Invalid addresses, groups, broadcasts return null immediately
    expect(await adapter.getUser('')).toBeNull();
    expect(await adapter.getUser('   ')).toBeNull();
    expect(await adapter.getUser('12345-67890@g.us')).toBeNull();
    expect(await adapter.getUser('status@broadcast')).toBeNull();
    expect(await adapter.getUser('random_string')).toBeNull();
  });

  it('should skip invalid entries during seeding and log warning', async () => {
    await adapter.seedUsers(['', 'not-a-valid-phone-or-jid']);
    expect(await adapter.countActiveUsers()).toBe(0);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Skipping invalid allowlist entry during seeding',
      undefined,
      expect.objectContaining({ entry: '' })
    );
  });

  it('should handle error when caching LID asynchronously', async () => {
    await adapter.seedUsers(['919876543210']);
    vi.spyOn(adapter, 'cacheLid').mockRejectedValueOnce(new Error('DB failure'));

    const allowed = await adapter.isAllowed('919876543210@s.whatsapp.net', '123456789012345@lid');
    expect(allowed).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to cache user LID asynchronously',
      expect.any(Error),
      expect.objectContaining({ phoneNumber: '919876543210', lid: '123456789012345@lid' })
    );
  });
});
