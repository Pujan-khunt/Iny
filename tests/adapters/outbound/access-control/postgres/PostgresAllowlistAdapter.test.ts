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
        pn_jid TEXT NOT NULL UNIQUE,
        lid_jid TEXT UNIQUE,
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
    await adapter.seedUsers([
      { phoneNumber: '+91 9876543210', name: 'Pujan' },
      { phoneNumber: '15551234567', name: 'Alice' },
    ]);
    expect(await adapter.countActiveUsers()).toBe(2);

    const user1 = await adapter.getAllowedUser('919876543210');
    expect(user1?.name).toBe('Pujan');
    expect(user1?.role).toBe('admin');

    const user2 = await adapter.getAllowedUser('15551234567');
    expect(user2?.name).toBe('Alice');
    expect(user2?.role).toBe('admin');

    // Cache an LIDJID
    await (adapter as any).cacheLidJid('919876543210', '123456789012345@lid');
    const user = await adapter.getAllowedUser('919876543210');
    expect(user?.lidJid).toBe('123456789012345@lid');

    // Simulate database revocation
    memDb.public.none("UPDATE allowed_users SET is_active = false WHERE phone_number = '919876543210'");

    // Re-seed: must NOT un-revoke the user
    await adapter.seedUsers([{ phoneNumber: '919876543210', name: 'Pujan' }]);
    const revokedUser = await adapter.getAllowedUser('919876543210');
    expect(revokedUser?.isActive).toBe(false);
    expect(await adapter.countActiveUsers()).toBe(1);
  });

  it('should authenticate active users by phone number, PNJID, and cached LIDJID', async () => {
    await adapter.seedUsers([{ phoneNumber: '919876543210' }]);
    await (adapter as any).cacheLidJid('919876543210', '987654321012345@lid');

    expect(await adapter.authenticate('919876543210')).not.toBeNull();
    expect(await adapter.authenticate('919876543210@s.whatsapp.net')).not.toBeNull();
    expect(await adapter.authenticate('987654321012345@lid')).not.toBeNull();
    expect(await adapter.authenticate('19999999999@s.whatsapp.net')).toBeNull();
  });

  it('should reject inactive users during authentication', async () => {
    await adapter.seedUsers([{ phoneNumber: '919876543210' }]);
    memDb.public.none("UPDATE allowed_users SET is_active = false WHERE phone_number = '919876543210'");

    expect(await adapter.authenticate('919876543210@s.whatsapp.net')).toBeNull();
  });

  it('should automatically cache incoming LIDJID when previously null', async () => {
    await adapter.seedUsers([{ phoneNumber: '919876543210' }]);
    let user = await adapter.getAllowedUser('919876543210');
    expect(user?.lidJid).toBeNull();
    expect(user?.name).toBeNull();

    // Check with pairedLidJid
    const authUser = await adapter.authenticate('919876543210@s.whatsapp.net', '123456789012345@lid');
    expect(authUser).not.toBeNull();
    expect(authUser?.lidJid).toBe('123456789012345@lid');

    user = await adapter.getAllowedUser('919876543210');
    expect(user?.lidJid).toBe('123456789012345@lid');

    // Subsequent call should recognize the cached LIDJID directly
    expect(await adapter.authenticate('123456789012345@lid')).not.toBeNull();
  });

  it('should return null for invalid or unparseable address during authentication', async () => {
    expect(await adapter.authenticate('')).toBeNull();
    expect(await adapter.authenticate('   ')).toBeNull();
    expect(await adapter.authenticate('invalid-group@g.us')).toBeNull();
  });

  it('should return null when getting a non-existent user', async () => {
    const user = await adapter.getAllowedUser('9999999999');
    expect(user).toBeNull();
  });

  it('should retrieve user by phone number, PNJID, and LIDJID via partitioned single-index lookup', async () => {
    await adapter.seedUsers([{ phoneNumber: '919876543210' }]);
    await (adapter as any).cacheLidJid('919876543210', '987654321012345@lid');

    // 1. By raw phone number
    const userByPhone = await adapter.getAllowedUser('919876543210');
    expect(userByPhone).not.toBeNull();
    expect(userByPhone?.phoneNumber).toBe('919876543210');
    expect(userByPhone?.pnJid).toBe('919876543210@s.whatsapp.net');
    expect(userByPhone?.lidJid).toBe('987654321012345@lid');

    // 2. By PNJID with device suffix
    const userByJid = await adapter.getAllowedUser('919876543210:1@s.whatsapp.net');
    expect(userByJid).not.toBeNull();
    expect(userByJid?.phoneNumber).toBe('919876543210');

    // 3. By formatted phone number
    const userByFormatted = await adapter.getAllowedUser('+91 98765 43210');
    expect(userByFormatted).not.toBeNull();
    expect(userByFormatted?.phoneNumber).toBe('919876543210');

    // 4. By LID with device suffix
    const userByLid = await adapter.getAllowedUser('987654321012345:2@lid');
    expect(userByLid).not.toBeNull();
    expect(userByLid?.phoneNumber).toBe('919876543210');

    // 5. Invalid addresses, groups, broadcasts return null immediately
    expect(await adapter.getAllowedUser('')).toBeNull();
    expect(await adapter.getAllowedUser('   ')).toBeNull();
    expect(await adapter.getAllowedUser('12345-67890@g.us')).toBeNull();
    expect(await adapter.getAllowedUser('status@broadcast')).toBeNull();
    expect(await adapter.getAllowedUser('random_string')).toBeNull();
  });

  it('should skip invalid entries during seeding and log warning', async () => {
    await adapter.seedUsers([{ phoneNumber: '' }, { phoneNumber: 'not-a-valid-phone-or-jid' }]);
    expect(await adapter.countActiveUsers()).toBe(0);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Skipping invalid allowlist entry during seeding',
      undefined,
      expect.objectContaining({ entry: { phoneNumber: '' } })
    );
  });

  it('should authenticate active users and populate paired LIDJID', async () => {
    await adapter.seedUsers([{ phoneNumber: '919876543210' }]);
    const unauthenticated = await adapter.authenticate('9999999999');
    expect(unauthenticated).toBeNull();

    // Authenticate with paired LIDJID
    const user = await adapter.authenticate('919876543210@s.whatsapp.net', '123456789012345@lid');
    expect(user).not.toBeNull();
    expect(user?.phoneNumber).toBe('919876543210');
    expect(user?.lidJid).toBe('123456789012345@lid');

    // Inactive user returns null
    memDb.public.none("UPDATE allowed_users SET is_active = false WHERE phone_number = '919876543210'");
    const inactive = await adapter.authenticate('919876543210');
    expect(inactive).toBeNull();
  });

  it('should handle error when caching LIDJID', async () => {
    await adapter.seedUsers([{ phoneNumber: '919876543210' }]);
    vi.spyOn(adapter as any, 'cacheLidJid').mockRejectedValueOnce(new Error('DB failure'));

    const authUser = await adapter.authenticate('919876543210@s.whatsapp.net', '123456789012345@lid');
    expect(authUser).not.toBeNull();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to cache user LID',
      expect.any(Error),
      expect.objectContaining({ phoneNumber: '919876543210', lidJid: '123456789012345@lid' })
    );
  });
});
