import { eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { allowedUsers } from './schema';
import { AllowlistPort, AllowlistAdminPort, AllowedUserRecord } from '../../../../core/ports/AllowlistPort';
import { WhatsAppJid } from '../../../common/whatsapp/WhatsAppJid';
import { LoggerPort } from '../../../../core/ports/LoggerPort';

type PgDb = NodePgDatabase<any> | PostgresJsDatabase<any>;

export class PostgresAllowlistAdapter implements AllowlistPort, AllowlistAdminPort {
  constructor(
    private db: PgDb,
    private logger: LoggerPort
  ) {}

  /**
   * Authenticates the given address and verifies the user is active.
   * If an incoming paired LID is provided and not yet cached, updates the record in PostgreSQL.
   */
  async authenticate(address: string, pairedLid?: string | null): Promise<AllowedUserRecord | null> {
    const user = await this.getUser(address);
    if (!user || !user.isActive) {
      return null;
    }

    // Auto-cache paired LID if not yet populated
    if (!user.lid && pairedLid) {
      const normalizedLid = WhatsAppJid.normalize(pairedLid);
      if (normalizedLid && WhatsAppJid.isLidUser(normalizedLid)) {
        await this.cacheLid(user.phoneNumber, normalizedLid).catch((err) => {
          this.logger.warn('Failed to cache user LID', err, {
            phoneNumber: user.phoneNumber,
            lid: normalizedLid,
          });
        });
        user.lid = normalizedLid;
      }
    }

    return user;
  }

  /**
   * Retrieves the full record for an allowed user by phone, JID, or LID.
   *
   * Executes a partitioned single-index lookup against PostgreSQL:
   * 1. Resolves normalized JID once (strips device suffixes).
   * 2. Partitions by identity type:
   *    - LID user: searches `lid` unique index directly.
   *    - PN user: extracts digits from normalized PNJID and searches `phone_number` Primary Key directly.
   * 3. Invalid inputs, groups, and broadcasts return null immediately without DB hits.
   */
  async getUser(address: string): Promise<AllowedUserRecord | null> {
    const normalized = WhatsAppJid.normalize(address);
    if (!normalized) {
      return null;
    }

    let query;
    if (WhatsAppJid.isLidUser(normalized)) {
      query = eq(allowedUsers.lid, normalized);
    } else if (WhatsAppJid.isPnUser(normalized)) {
      const rawDigits = normalized.replace('@s.whatsapp.net', '');
      query = eq(allowedUsers.phoneNumber, rawDigits);
    } else {
      return null;
    }

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

  private async cacheLid(phoneNumber: string, lid: string): Promise<void> {
    await this.db
      .update(allowedUsers)
      .set({
        lid,
        updatedAt: new Date(),
      })
      .where(eq(allowedUsers.phoneNumber, phoneNumber));
  }
}
