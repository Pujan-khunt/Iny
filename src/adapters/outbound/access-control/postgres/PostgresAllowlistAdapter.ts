import { eq, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { allowedUsers } from './schema';
import { AllowlistPort, AllowedUserRecord } from '../AllowlistPort';
import { WhatsAppJid } from '../../../common/whatsapp/WhatsAppJid';
import { LoggerPort } from '../../../../core/ports/LoggerPort';

type PgDb = NodePgDatabase<any> | PostgresJsDatabase<any>;

export class PostgresAllowlistAdapter implements AllowlistPort {
  constructor(
    private db: PgDb,
    private logger: LoggerPort
  ) {}

  async isAllowed(address: string, pairedLid?: string | null): Promise<boolean> {
    const normalized = WhatsAppJid.normalize(address);
    if (!normalized) {
      return false;
    }

    const user = await this.getUser(normalized);
    if (!user || !user.isActive) {
      return false;
    }

    // Auto-cache paired LID if not yet populated
    if (!user.lid && pairedLid) {
      const normalizedLid = WhatsAppJid.normalize(pairedLid);
      if (normalizedLid && WhatsAppJid.isLidUser(normalizedLid)) {
        this.cacheLid(user.phoneNumber, normalizedLid).catch((err) => {
          this.logger.warn('Failed to cache user LID asynchronously', err, {
            phoneNumber: user.phoneNumber,
            lid: normalizedLid,
          });
        });
      }
    }

    return true;
  }

  /**
   * Retrieves the full record for an allowed user by phone, JID, or LID.
   *
   * Executes a polymorphic query against PostgreSQL:
   * 1. Resolves normalized JID (strips device suffixes) and raw phone digits.
   * 2. Dynamically builds an indexed SQL condition matching `phone_number` PK,
   *    `jid` unique index, or `lid` unique index.
   * 3. Leverages PostgreSQL BitmapOr index scan for O(1) performance without table scans.
   */
  async getUser(address: string): Promise<AllowedUserRecord | null> {
    // 1. Pre-process address: extract standardized JID and/or phone digits
    const normalized = WhatsAppJid.normalize(address);
    const rawDigits = WhatsAppJid.toPhoneNumber(address) || address.replace(/\D/g, '');

    // 2. Build dynamic indexed WHERE clauses
    const clauses = [];
    if (normalized) {
      // Matches @s.whatsapp.net (phone JID) or @lid (linked identity)
      clauses.push(eq(allowedUsers.jid, normalized));
      clauses.push(eq(allowedUsers.lid, normalized));
    }
    if (rawDigits) {
      // Matches clean numeric digits against the phone_number primary key
      clauses.push(eq(allowedUsers.phoneNumber, rawDigits));
    }

    // Fast exit: if input is invalid/empty, avoid unnecessary database round-trip
    if (clauses.length === 0) {
      return null;
    }

    // 3. Execute query: single clause uses direct equality; multiple clauses use OR
    const query = clauses.length === 1 ? clauses[0] : or(...clauses);
    const rows = await this.db.select().from(allowedUsers).where(query).limit(1);
    if (!rows.length) {
      return null;
    }

    // 4. Map Drizzle database row to domain AllowedUserRecord port interface
    const row = rows[0];
    return {
      phoneNumber: row.phoneNumber,
      jid: row.jid,
      lid: row.lid,
      name: row.name,
      role: row.role as 'admin' | 'user',
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async seedUsers(entries: string[]): Promise<void> {
    for (const entry of entries) {
      const jid = WhatsAppJid.normalize(entry);
      const phoneNumber = WhatsAppJid.toPhoneNumber(entry);

      if (!jid || !phoneNumber) {
        this.logger.warn('Skipping invalid allowlist entry during seeding', undefined, { entry });
        continue;
      }

      await this.db
        .insert(allowedUsers)
        .values({
          phoneNumber,
          jid,
          name: 'Initial Admin',
          role: 'admin',
          isActive: true,
        })
        .onConflictDoNothing({ target: allowedUsers.phoneNumber });
    }
  }

  async countActiveUsers(): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(allowedUsers)
      .where(eq(allowedUsers.isActive, true));

    return result[0]?.count ?? 0;
  }

  async cacheLid(phoneNumber: string, lid: string): Promise<void> {
    await this.db
      .update(allowedUsers)
      .set({
        lid,
        updatedAt: new Date(),
      })
      .where(eq(allowedUsers.phoneNumber, phoneNumber));
  }
}
