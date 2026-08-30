/**
 * PostgreSQL-backed Authentication State for Baileys
 *
 * Persists WhatsApp cryptographic credentials and Signal key sets directly to PostgreSQL.
 * Combined with `makeCacheableSignalKeyStore`, all hot cryptographic keys are served
 * in-memory with microsecond latency, while being resilient to container restarts.
 */

import {
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore,
  BufferJSON,
  initAuthCreds,
  proto,
} from "@whiskeysockets/baileys";
import { eq, inArray, sql } from "drizzle-orm";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AUTH_DIR } from "../config.js";
import { db } from "../db/index.js";
import { baileysAuth } from "../db/schema.js";
import { getLogger } from "../logger.js";

const logger = getLogger("auth-state");

/**
 * Initializes and returns the PostgreSQL-backed authentication state for Baileys.
 */
export async function useDbAuthState(): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  // 1. Fetch credentials from PostgreSQL
  const credsRow = await db
    .select({ data: baileysAuth.data })
    .from(baileysAuth)
    .where(eq(baileysAuth.id, "creds"))
    .limit(1);

  let creds: AuthenticationCreds;

  if (credsRow.length > 0 && credsRow[0]?.data) {
    creds = JSON.parse(credsRow[0].data, BufferJSON.reviver);
  } else {
    // Check if an existing file-based session exists to migrate (zero QR re-scan)
    const migratedCreds = await tryMigrateFromFileStore(AUTH_DIR);
    if (migratedCreds) {
      creds = migratedCreds;
    } else {
      creds = initAuthCreds();
      await saveCredsToDb(creds);
    }
  }

  async function saveCredsToDb(credsToSave: AuthenticationCreds): Promise<void> {
    await db
      .insert(baileysAuth)
      .values({
        id: "creds",
        data: JSON.stringify(credsToSave, BufferJSON.replacer),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: baileysAuth.id,
        set: {
          data: sql`excluded.data`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  // 2. Implement SignalKeyStore for PostgreSQL
  const keys: SignalKeyStore = {
    async get(type, ids) {
      if (ids.length === 0) return {};

      const prefixedIds = ids.map((id) => `${type}-${id}`);
      const rows = await db
        .select({ id: baileysAuth.id, data: baileysAuth.data })
        .from(baileysAuth)
        .where(inArray(baileysAuth.id, prefixedIds));

      const result: { [id: string]: SignalDataTypeMap[typeof type] } = {};

      for (const row of rows) {
        // Strip prefix: `${type}-` -> `id`
        const keyId = row.id.slice(type.length + 1);
        let parsed = JSON.parse(row.data, BufferJSON.reviver);
        if (type === "app-state-sync-key" && parsed) {
          parsed = proto.Message.AppStateSyncKeyData.fromObject(parsed);
        }
        result[keyId] = parsed;
      }

      return result;
    },

    async set(data: SignalDataSet) {
      const inserts: Array<{ id: string; data: string; updatedAt: Date }> = [];
      const deletes: string[] = [];

      for (const type of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
        const typeData = data[type];
        if (!typeData) continue;

        for (const id of Object.keys(typeData)) {
          const value = typeData[id];
          const key = `${type}-${id}`;

          if (value) {
            inserts.push({
              id: key,
              data: JSON.stringify(value, BufferJSON.replacer),
              updatedAt: new Date(),
            });
          } else {
            deletes.push(key);
          }
        }
      }

      if (deletes.length > 0) {
        await db.delete(baileysAuth).where(inArray(baileysAuth.id, deletes));
      }

      if (inserts.length > 0) {
        await db
          .insert(baileysAuth)
          .values(inserts)
          .onConflictDoUpdate({
            target: baileysAuth.id,
            set: {
              data: sql`excluded.data`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      }
    },

    async clear() {
      await db.delete(baileysAuth);
    },
  };

  return {
    state: {
      creds,
      keys,
    },
    saveCreds: () => saveCredsToDb(creds),
  };
}

/**
 * Automatically imports existing file-based session from auth_info_baileys/ if present on disk.
 * Allows zero-downtime migration without needing to re-scan the WhatsApp QR code.
 */
async function tryMigrateFromFileStore(authDir: string): Promise<AuthenticationCreds | null> {
  const credsPath = join(authDir, "creds.json");
  if (!existsSync(credsPath)) {
    return null;
  }

  try {
    logger.info({ authDir }, "Migrating existing file-based WhatsApp session to PostgreSQL...");
    const files = await readdir(authDir);
    const inserts: Array<{ id: string; data: string; updatedAt: Date }> = [];
    let initialCreds: AuthenticationCreds | null = null;

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const content = await readFile(join(authDir, file), "utf-8");

      if (file === "creds.json") {
        initialCreds = JSON.parse(content, BufferJSON.reviver);
        inserts.push({ id: "creds", data: content, updatedAt: new Date() });
      } else {
        const id = file.replace(/\.json$/, "");
        inserts.push({ id, data: content, updatedAt: new Date() });
      }
    }

    if (inserts.length > 0) {
      await db.insert(baileysAuth).values(inserts).onConflictDoNothing();
      logger.info({ fileCount: inserts.length }, "WhatsApp session successfully migrated to PostgreSQL");
    }

    return initialCreds;
  } catch (err) {
    logger.error({ err }, "Failed to migrate file auth state to database");
    return null;
  }
}
