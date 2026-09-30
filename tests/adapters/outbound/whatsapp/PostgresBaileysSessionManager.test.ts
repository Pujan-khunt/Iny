import { describe, it, expect, beforeEach, vi } from 'vitest';
import { newDb } from 'pg-mem';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PostgresBaileysSessionManager } from '../../../../src/adapters/outbound/whatsapp/PostgresBaileysSessionManager';
import { LoggerPort } from '../../../../src/core/ports/LoggerPort';
import { proto } from '@whiskeysockets/baileys';
import { eq, and, inArray } from 'drizzle-orm';
import { whatsappAuth } from '../../../../src/adapters/outbound/whatsapp/postgres/schema';

describe('PostgresBaileysSessionManager', () => {
  let db: NodePgDatabase;
  let manager: PostgresBaileysSessionManager;
  const mockLogger: LoggerPort = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    const memDb = newDb();
    memDb.public.none(`
      CREATE TABLE whatsapp_auth (
        session_id VARCHAR(128) NOT NULL DEFAULT 'default',
        key VARCHAR(255) NOT NULL,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT whatsapp_auth_session_id_key_pk PRIMARY KEY (session_id, key)
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
    manager = new PostgresBaileysSessionManager(db, mockLogger, 'default');
  });

  describe('Session Initialization & Creds Persistence', () => {
    it('should generate initial credentials when starting with an empty database', async () => {
      const session = await manager.initSession();
      expect(session.state.creds).toBeDefined();
      expect(session.state.creds.noiseKey).toBeDefined();
      expect(Buffer.isBuffer(session.state.creds.noiseKey.private)).toBe(true);
      expect(session.state.creds.registered).toBe(false);
    });

    it('should persist credentials via saveCreds and restore them identically on subsequent initSession', async () => {
      const session1 = await manager.initSession();
      session1.state.creds.registered = true;
      session1.state.creds.me = { id: '15551234567@s.whatsapp.net', name: 'Iny' };
      await session1.saveCreds();

      const session2 = await manager.initSession();
      expect(session2.state.creds.registered).toBe(true);
      expect(session2.state.creds.me).toEqual({ id: '15551234567@s.whatsapp.net', name: 'Iny' });
      expect(Buffer.isBuffer(session2.state.creds.noiseKey.private)).toBe(true);
      expect(session2.state.creds.noiseKey.private.equals(session1.state.creds.noiseKey.private)).toBe(true);
    });
  });

  describe('SignalKeyStore get & set Operations', () => {
    it('should return undefined or null for non-existent keys in batch get', async () => {
      const session = await manager.initSession();
      const result = await session.state.keys.get('pre-key', ['1', '2']);
      expect(result['1']).toBeUndefined();
      expect(result['2']).toBeUndefined();
    });

    it('should batch insert keys and retrieve them with preserved Buffer prototypes', async () => {
      const session = await manager.initSession();
      const pubBuf = Buffer.from('public-key-bytes');
      const privBuf = Buffer.from('private-key-bytes');

      await session.state.keys.set({
        'pre-key': {
          '100': { keyPair: { public: pubBuf, private: privBuf } },
        },
      });

      const keys = await session.state.keys.get('pre-key', ['100']);
      expect(keys['100']).toBeDefined();
      expect(Buffer.isBuffer(keys['100'].keyPair.public)).toBe(true);
      expect(Buffer.isBuffer(keys['100'].keyPair.private)).toBe(true);
      expect(keys['100'].keyPair.public.equals(pubBuf)).toBe(true);
      expect(keys['100'].keyPair.private.equals(privBuf)).toBe(true);
    });

    it('should revive app-state-sync-key as proto AppStateSyncKeyData instances', async () => {
      const session = await manager.initSession();
      const syncKeyData = proto.Message.AppStateSyncKeyData.fromObject({
        keyData: Buffer.from('sync-data-bytes'),
      });

      await session.state.keys.set({
        'app-state-sync-key': {
          'sync-1': syncKeyData,
        },
      });

      const keys = await session.state.keys.get('app-state-sync-key', ['sync-1']);
      expect(keys['sync-1']).toBeDefined();
      expect(keys['sync-1'].keyData).toBeDefined();
      expect(Buffer.isBuffer(keys['sync-1'].keyData)).toBe(true);
    });

    it('should delete keys when set is called with null or undefined values', async () => {
      const session = await manager.initSession();
      await session.state.keys.set({
        'session': {
          'user-1': { active: true },
        },
      });

      const before = await session.state.keys.get('session', ['user-1']);
      expect(before['user-1']).toEqual({ active: true });

      // Delete by setting to null
      await session.state.keys.set({
        'session': {
          'user-1': null,
        },
      });

      const after = await session.state.keys.get('session', ['user-1']);
      expect(after['user-1']).toBeUndefined();
    });

    it('should properly upsert falsy non-null values and not delete them', async () => {
      const session = await manager.initSession();

      // First insert an existing key to verify updating to falsy non-null does not delete it
      await session.state.keys.set({
        session: {
          'existing-bool': true,
        },
      });

      // Update existing key to false, and set other falsy non-null values (number 0, empty string "")
      await session.state.keys.set({
        session: {
          'existing-bool': false,
          'num-zero': 0,
          'empty-string': '',
        },
      });

      // Direct DB query verifying that falsy non-null values were upserted and not deleted
      const rows = await db
        .select()
        .from(whatsappAuth)
        .where(
          and(
            eq(whatsappAuth.sessionId, 'default'),
            inArray(whatsappAuth.key, [
              'session-existing-bool',
              'session-num-zero',
              'session-empty-string',
            ])
          )
        );

      expect(rows).toHaveLength(3);
      const rowMap = new Map(rows.map((r) => [r.key, r.value]));
      expect(rowMap.get('session-existing-bool')).toBe(false);
      expect(rowMap.get('session-num-zero')).toBe(0);
      expect(rowMap.get('session-empty-string')).toBe('');
    });

    it('should serve hot keys from the in-memory cache without hitting the database', async () => {
      const session = await manager.initSession();
      await session.state.keys.set({
        'sender-key': {
          'group-1': { secret: Buffer.from('secret-bytes') },
        },
      });

      const selectSpy = vi.spyOn(db, 'select');

      // First get hits cache since it was set via session.state.keys.set
      const result1 = await session.state.keys.get('sender-key', ['group-1']);
      expect(result1['group-1']).toBeDefined();
      expect(selectSpy).not.toHaveBeenCalled();

      // Subsequent get also hits cache
      const result2 = await session.state.keys.get('sender-key', ['group-1']);
      expect(result2['group-1']).toBeDefined();
      expect(selectSpy).not.toHaveBeenCalled();
    });
  });

  describe('Multi-Account Partitioning & Purge', () => {
    it('should isolate sessions by sessionId so accounts do not conflict', async () => {
      const managerA = new PostgresBaileysSessionManager(db, mockLogger, 'account-a');
      const managerB = new PostgresBaileysSessionManager(db, mockLogger, 'account-b');

      const sessionA = await managerA.initSession();
      const sessionB = await managerB.initSession();

      sessionA.state.creds.me = { id: 'accountA@s.whatsapp.net', name: 'Bot A' };
      sessionB.state.creds.me = { id: 'accountB@s.whatsapp.net', name: 'Bot B' };

      await sessionA.saveCreds();
      await sessionB.saveCreds();

      const reloadA = await managerA.initSession();
      const reloadB = await managerB.initSession();

      expect(reloadA.state.creds.me?.name).toBe('Bot A');
      expect(reloadB.state.creds.me?.name).toBe('Bot B');
    });

    it('should purge only the targeted session rows upon purgeSession', async () => {
      const managerA = new PostgresBaileysSessionManager(db, mockLogger, 'account-a');
      const managerB = new PostgresBaileysSessionManager(db, mockLogger, 'account-b');

      const sessionA = await managerA.initSession();
      const sessionB = await managerB.initSession();

      sessionA.state.creds.registered = true;
      sessionB.state.creds.registered = true;

      await sessionA.saveCreds();
      await sessionB.saveCreds();

      await managerA.purgeSession();

      // Reloading account-a yields fresh unregistered creds
      const reloadedA = await managerA.initSession();
      expect(reloadedA.state.creds.registered).toBe(false);

      // Account-b remains registered
      const reloadedB = await managerB.initSession();
      expect(reloadedB.state.creds.registered).toBe(true);
    });

    it('should invoke purgeSession when session.state.keys.clear is called', async () => {
      const session = await manager.initSession();
      session.state.creds.registered = true;
      await session.saveCreds();

      await session.state.keys.clear?.();

      const reloaded = await manager.initSession();
      expect(reloaded.state.creds.registered).toBe(false);
    });
  });

  describe('Edge Cases & Error Handling', () => {
    it('should handle empty ids array in SignalKeyStore.get without query', async () => {
      const session = await manager.initSession();
      const selectSpy = vi.spyOn(db, 'select');
      const result = await session.state.keys.get('pre-key', []);
      expect(result).toEqual({});
      expect(selectSpy).not.toHaveBeenCalled();
    });

    it('should handle empty data object in SignalKeyStore.set without error', async () => {
      const session = await manager.initSession();
      const txSpy = vi.spyOn(db, 'transaction');
      await session.state.keys.set({});
      expect(txSpy).not.toHaveBeenCalled();
    });

    it('should log error when db fails during keys.get and return null entries', async () => {
      const session = await manager.initSession();
      vi.spyOn(db, 'select').mockImplementationOnce(() => {
        throw new Error('Database select failure');
      });

      const result = await session.state.keys.get('pre-key', ['err-id']);
      expect(result['err-id']).toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get Signal keys from PostgreSQL',
        expect.any(Error),
        expect.objectContaining({ type: 'pre-key', idsCount: 1, sessionId: 'default' })
      );
    });

    it('should log error and rethrow when db fails during keys.set', async () => {
      const session = await manager.initSession();
      vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('Transaction failed'));

      await expect(
        session.state.keys.set({
          'pre-key': {
            'fail-id': { key: 'val' },
          },
        })
      ).rejects.toThrow('Transaction failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to set Signal keys in PostgreSQL',
        expect.any(Error),
        expect.objectContaining({ sessionId: 'default', upsertCount: 1, deleteCount: 0 })
      );
    });

    it('should log error and rethrow when db fails during purgeSession', async () => {
      vi.spyOn(db, 'delete').mockImplementationOnce(() => {
        throw new Error('Delete failed');
      });

      await expect(manager.purgeSession()).rejects.toThrow('Delete failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to purge session credentials from PostgreSQL',
        expect.any(Error),
        expect.objectContaining({ sessionId: 'default' })
      );
    });

    it('should log error and return null when db fails during readData', async () => {
      vi.spyOn(db, 'select').mockImplementationOnce(() => {
        throw new Error('Read error');
      });

      // initSession calls readData('creds')
      const session = await manager.initSession();
      expect(session.state.creds).toBeDefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to read WhatsApp auth data from PostgreSQL',
        expect.any(Error),
        expect.objectContaining({ key: 'creds', sessionId: 'default' })
      );
    });

    it('should log error and rethrow when db fails during writeData', async () => {
      const session = await manager.initSession();
      vi.spyOn(db, 'insert').mockImplementationOnce(() => {
        throw new Error('Insert error');
      });

      await expect(session.saveCreds()).rejects.toThrow('Insert error');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to write WhatsApp auth data to PostgreSQL',
        expect.any(Error),
        expect.objectContaining({ key: 'creds', sessionId: 'default' })
      );
    });
  });
});
