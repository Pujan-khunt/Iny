import { eq, and, inArray, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import {
  AuthenticationState,
  AuthenticationCreds,
  SignalKeyStore,
  SignalDataTypeMap,
  BufferJSON,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  proto,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { LoggerPort } from '../../../core/ports/LoggerPort';
import { whatsappAuth } from './postgres/schema';

export interface BaileysSession {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}

export interface BaileysSessionManagerPort {
  initSession(): Promise<BaileysSession>;
  purgeSession(): Promise<void>;
}

/**
 * PostgreSQL-backed implementation of Baileys authentication and Signal key store
 * with in-memory caching and buffer preservation.
 */
export class PostgresBaileysSessionManager implements BaileysSessionManagerPort {
  constructor(
    private db: PgDatabase<any, any, any>,
    private logger: LoggerPort,
    private sessionId: string = 'default'
  ) {}

  async initSession(): Promise<BaileysSession> {
    const credsData = await this.readData('creds');
    const creds: AuthenticationCreds = credsData || initAuthCreds();

    const rawKeyStore: SignalKeyStore = {
      get: async (type: string, ids: string[]) => {
        const data: { [id: string]: any } = {};
        if (ids.length === 0) {
          return data;
        }

        const dbKeys = ids.map((id) => `${type}-${id}`);
        try {
          const rows = await this.db
            .select({ key: whatsappAuth.key, value: whatsappAuth.value })
            .from(whatsappAuth)
            .where(
              and(
                eq(whatsappAuth.sessionId, this.sessionId),
                inArray(whatsappAuth.key, dbKeys)
              )
            );

          const rowMap = new Map<string, any>();
          for (const row of rows) {
            let revived = JSON.parse(JSON.stringify(row.value), BufferJSON.reviver);
            if (type === 'app-state-sync-key' && revived) {
              revived = proto.Message.AppStateSyncKeyData.fromObject(revived);
            }
            rowMap.set(row.key, revived);
          }

          for (const id of ids) {
            const dbKey = `${type}-${id}`;
            const item = rowMap.get(dbKey);
            data[id] = item !== undefined ? item : null;
          }
        } catch (err) {
          this.logger.error('Failed to get Signal keys from PostgreSQL', err, {
            type,
            idsCount: ids.length,
            sessionId: this.sessionId,
          });
          for (const id of ids) {
            data[id] = null;
          }
        }
        return data;
      },

      set: async (data: any) => {
        const toUpsert: Array<{ sessionId: string; key: string; value: any; updatedAt: Date }> = [];
        const toDelete: string[] = [];

        for (const category in data) {
          for (const id in data[category]) {
            const value = data[category][id];
            const dbKey = `${category}-${id}`;
            if (value) {
              const serialized = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
              toUpsert.push({
                sessionId: this.sessionId,
                key: dbKey,
                value: serialized,
                updatedAt: new Date(),
              });
            } else {
              toDelete.push(dbKey);
            }
          }
        }

        if (toUpsert.length === 0 && toDelete.length === 0) {
          return;
        }

        try {
          await this.db.transaction(async (tx) => {
            if (toUpsert.length > 0) {
              await tx
                .insert(whatsappAuth)
                .values(toUpsert)
                .onConflictDoUpdate({
                  target: [whatsappAuth.sessionId, whatsappAuth.key],
                  set: {
                    value: sql`excluded.value`,
                    updatedAt: new Date(),
                  },
                });
            }
            if (toDelete.length > 0) {
              await tx
                .delete(whatsappAuth)
                .where(
                  and(
                    eq(whatsappAuth.sessionId, this.sessionId),
                    inArray(whatsappAuth.key, toDelete)
                  )
                );
            }
          });
        } catch (err) {
          this.logger.error('Failed to set Signal keys in PostgreSQL', err, {
            sessionId: this.sessionId,
            upsertCount: toUpsert.length,
            deleteCount: toDelete.length,
          });
          throw err;
        }
      },

      clear: async () => {
        await this.purgeSession();
      },
    };

    const cacheableKeys = makeCacheableSignalKeyStore(
      rawKeyStore,
      pino({ level: 'silent' })
    );

    return {
      state: {
        creds,
        keys: {
          ...cacheableKeys,
          get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
            const result = await cacheableKeys.get(type, ids);
            for (const id of ids) {
              if ((result as Record<string, unknown>)[id] === null) {
                delete (result as Record<string, unknown>)[id];
              }
            }
            return result;
          },
        },
      },
      saveCreds: async () => {
        await this.writeData('creds', creds);
      },
    };
  }

  async purgeSession(): Promise<void> {
    try {
      await this.db
        .delete(whatsappAuth)
        .where(eq(whatsappAuth.sessionId, this.sessionId));
      this.logger.info('WhatsApp session credentials purged successfully from PostgreSQL', {
        sessionId: this.sessionId,
      });
    } catch (err) {
      this.logger.error('Failed to purge session credentials from PostgreSQL', err, {
        sessionId: this.sessionId,
      });
      throw err;
    }
  }

  private async readData(key: string): Promise<any> {
    try {
      const rows = await this.db
        .select({ value: whatsappAuth.value })
        .from(whatsappAuth)
        .where(
          and(
            eq(whatsappAuth.sessionId, this.sessionId),
            eq(whatsappAuth.key, key)
          )
        )
        .limit(1);

      if (rows.length === 0) {
        return null;
      }

      return JSON.parse(JSON.stringify(rows[0].value), BufferJSON.reviver);
    } catch (err) {
      this.logger.error('Failed to read WhatsApp auth data from PostgreSQL', err, {
        key,
        sessionId: this.sessionId,
      });
      return null;
    }
  }

  private async writeData(key: string, data: any): Promise<void> {
    const serialized = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
    try {
      await this.db
        .insert(whatsappAuth)
        .values({
          sessionId: this.sessionId,
          key,
          value: serialized,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [whatsappAuth.sessionId, whatsappAuth.key],
          set: {
            value: sql`excluded.value`,
            updatedAt: new Date(),
          },
        });
    } catch (err) {
      this.logger.error('Failed to write WhatsApp auth data to PostgreSQL', err, {
        key,
        sessionId: this.sessionId,
      });
      throw err;
    }
  }
}
