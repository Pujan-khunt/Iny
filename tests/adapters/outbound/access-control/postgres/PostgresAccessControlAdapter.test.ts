import { describe, it, expect, beforeEach, vi } from 'vitest';
import { newDb } from 'pg-mem';
import { drizzle } from 'drizzle-orm/node-postgres';
import { PostgresAccessControlAdapter } from '../../../../../src/adapters/outbound/access-control/postgres/PostgresAccessControlAdapter';
import { LoggerPort } from '../../../../../src/core/ports/LoggerPort';

describe('PostgresAccessControlAdapter', () => {
  let memDb: any;
  let db: any;
  let adapter: PostgresAccessControlAdapter;
  let mockLogger: LoggerPort;

  beforeEach(async () => {
    memDb = newDb();
    memDb.public.none(`
      CREATE TABLE users (
        phone_number TEXT PRIMARY KEY,
        pn_jid TEXT NOT NULL UNIQUE,
        lid_jid TEXT UNIQUE,
        name TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'pending',
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

    adapter = new PostgresAccessControlAdapter(db, mockLogger);
  });

  it('should seed users with ON CONFLICT DO NOTHING and default to active and admin', async () => {
    await adapter.seedUsers([
      { phoneNumber: '+91 9876543210', name: 'Pujan' },
      { phoneNumber: '15551234567', name: 'Alice' },
    ]);
    expect(await adapter.countActiveUsers()).toBe(2);

    const user1 = await adapter.getUser('919876543210');
    expect(user1?.name).toBe('Pujan');
    expect(user1?.role).toBe('admin');
    expect(user1?.status).toBe('active');

    const user2 = await adapter.getUser('15551234567');
    expect(user2?.name).toBe('Alice');
    expect(user2?.role).toBe('admin');
    expect(user2?.status).toBe('active');

    // Cache an LIDJID
    await (adapter as any).cacheLidJid('919876543210', '123456789012345@lid');
    const user = await adapter.getUser('919876543210');
    expect(user?.lidJid).toBe('123456789012345@lid');

    // Simulate database revocation
    memDb.public.none("UPDATE users SET status = 'revoked' WHERE phone_number = '919876543210'");

    // Re-seed: must NOT un-revoke the user
    await adapter.seedUsers([{ phoneNumber: '919876543210', name: 'Pujan' }]);
    const revokedUser = await adapter.getUser('919876543210');
    expect(revokedUser?.status).toBe('revoked');
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

  it('should reject non-active users (revoked, suspended, pending) during authenticate and log warning', async () => {
    await adapter.seedUsers([{ phoneNumber: '919876543210' }]);

    // Status: revoked
    memDb.public.none("UPDATE users SET status = 'revoked' WHERE phone_number = '919876543210'");
    expect(await adapter.authenticate('919876543210@s.whatsapp.net')).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Blocked interaction from inactive user',
      undefined,
      expect.objectContaining({ phoneNumber: '919876543210', status: 'revoked' })
    );

    // Status: suspended
    memDb.public.none("UPDATE users SET status = 'suspended' WHERE phone_number = '919876543210'");
    expect(await adapter.authenticate('919876543210@s.whatsapp.net')).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Blocked interaction from inactive user',
      undefined,
      expect.objectContaining({ phoneNumber: '919876543210', status: 'suspended' })
    );

    // Status: pending
    memDb.public.none("UPDATE users SET status = 'pending' WHERE phone_number = '919876543210'");
    expect(await adapter.authenticate('919876543210@s.whatsapp.net')).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Blocked interaction from inactive user',
      undefined,
      expect.objectContaining({ phoneNumber: '919876543210', status: 'pending' })
    );
  });

  it('should auto-cache companion LIDJID upon authentication and log info', async () => {
    await adapter.seedUsers([{ phoneNumber: '919876543210' }]);

    const authUser = await adapter.authenticate(
      '919876543210@s.whatsapp.net',
      '123456789012345@lid'
    );
    expect(authUser).not.toBeNull();
    expect(authUser?.lidJid).toBe('123456789012345@lid');
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Cached linked identity (LID) for user',
      expect.objectContaining({ phoneNumber: '919876543210', lidJid: '123456789012345@lid' })
    );

    // Subsequent lookup by LID must succeed
    expect(await adapter.authenticate('123456789012345@lid')).not.toBeNull();
  });

  it('should not mutate in-memory user.lidJid or log info if database write fails in cacheLidJid', async () => {
    await adapter.seedUsers([{ phoneNumber: '919876543210' }]);

    // Force cacheLidJid to fail
    vi.spyOn(adapter as any, 'cacheLidJid').mockRejectedValueOnce(new Error('DB write failed'));

    const authUser = await adapter.authenticate(
      '919876543210@s.whatsapp.net',
      '123456789012345@lid'
    );

    // User is still returned authenticated
    expect(authUser).not.toBeNull();
    // In-memory lidJid must NOT be mutated to false success state
    expect(authUser?.lidJid).toBeNull();
    // Warning logged
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to cache user LID',
      expect.any(Error),
      expect.objectContaining({ phoneNumber: '919876543210', lidJid: '123456789012345@lid' })
    );
    // Info log for success must NOT be called
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      'Cached linked identity (LID) for user',
      expect.anything()
    );
  });

  it('should handle malformed, empty, or group addresses safely without errors', async () => {
    expect(await adapter.authenticate('')).toBeNull();
    expect(await adapter.authenticate('   ')).toBeNull();
    expect(await adapter.authenticate('invalid-group@g.us')).toBeNull();
    expect(await adapter.getUser('')).toBeNull();
    expect(await adapter.getUser('group@g.us')).toBeNull();
  });

  it('should skip invalid entries during seedUsers with a warning', async () => {
    await adapter.seedUsers([
      { phoneNumber: 'too-short' },
      { phoneNumber: '' },
      { phoneNumber: '+91 9876543210' },
    ]);

    expect(await adapter.countActiveUsers()).toBe(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Skipping invalid access control entry during seeding',
      undefined,
      expect.any(Object)
    );
  });
});
