import { eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { users } from './schema';
import {
  AccessControlPort,
  AccessControlAdminPort,
  UserRecord,
  SeedUserEntry,
} from '../../../../core/ports/AccessControlPort';
import { WhatsAppJid } from '../../../common/whatsapp/WhatsAppJid';
import { LoggerPort } from '../../../../core/ports/LoggerPort';

type PgDb = NodePgDatabase<any> | PostgresJsDatabase<any>;

export class PostgresAccessControlAdapter implements AccessControlPort, AccessControlAdminPort {
  constructor(
    private db: PgDb,
    private logger: LoggerPort
  ) { }

  /**
   * Authenticates the given address (phone, PNJID, or LIDJID) and verifies the user is active.
   *
   * Gatekeeper pattern:
   * Returns a valid UserRecord ONLY if the user exists and status === 'active'.
   * Inactive states ('pending', 'revoked', 'suspended') return null and log an appropriate warning.
   *
   * If an incoming companion LIDJID is provided and not yet cached for this user,
   * synchronously persists it to PostgreSQL.
   */
  async authenticate(address: string, companionLidJid?: string | null): Promise<UserRecord | null> {
    const user = await this.getUser(address);
    if (!user) {
      return null;
    }

    if (user.status !== 'active') {
      this.logger.warn('Blocked interaction from inactive user', undefined, {
        phoneNumber: user.phoneNumber,
        status: user.status,
        address,
      });
      return null;
    }

    // Auto-cache companion LIDJID if not yet populated.
    // Normalization strips any multi-device suffixes (e.g. :1, :2) ensuring canonical persistence.
    if (!user.lidJid && companionLidJid) {
      const normalizedLidJid = WhatsAppJid.normalize(companionLidJid);
      if (normalizedLidJid && WhatsAppJid.isLidUser(normalizedLidJid)) {
        try {
          await this.cacheLidJid(user.phoneNumber, normalizedLidJid);
          this.logger.info('Cached linked identity (LID) for user', {
            phoneNumber: user.phoneNumber,
            lidJid: normalizedLidJid,
          });
          user.lidJid = normalizedLidJid;
        } catch (err) {
          this.logger.warn('Failed to cache user LID', err, {
            phoneNumber: user.phoneNumber,
            lidJid: normalizedLidJid,
          });
        }
      }
    }

    return user;
  }

  /**
   * Retrieves the full record for a user by phone number, PNJID, or LIDJID.
   *
   * Partitioned Single-Index Lookup:
   *    Incoming WhatsApp identifiers strictly conform to one of two mutually exclusive schemas:
   *    - Linked Identity (`<lid>@lid`): searched against the `idx_users_lid_jid` partial unique index.
   *    - Phone Number Identity (`<phone>@s.whatsapp.net` or raw digits): normalized to canonical PNJID
   *      and searched directly against the `idx_users_pn_jid` unique index.
   *    Partitioning the query before hitting PostgreSQL ensures an index-seek (O(1)) rather than a
   *    costly BitmapOr multi-index scan.
   */
  async getUser(address: string): Promise<UserRecord | null> {
    // Normalizes phone numbers into a PNJID.
    const normalized = WhatsAppJid.normalize(address);
    if (!normalized) {
      return null;
    }

    const isLid = WhatsAppJid.isLidUser(normalized);
    const isPn = WhatsAppJid.isPnUser(normalized);

    // Guard: Reject non-user stanzas immediately before constructing any query
    if (!isLid && !isPn) {
      return null;
    }

    // Const expression: guaranteed non-null, targeting the appropriate unique index
    const query = isLid ? eq(users.lidJid, normalized) : eq(users.pnJid, normalized);

    const rows = await this.db.select().from(users).where(query).limit(1);
    if (!rows.length) {
      return null;
    }

    return rows[0];
  }

  /**
   * Seeds initial users into PostgreSQL with ON CONFLICT (phone_number) DO NOTHING.
   * Initial seeded users are granted role: 'admin' and status: 'active'.
   */
  async seedUsers(entries: SeedUserEntry[]): Promise<void> {
    for (const entry of entries) {
      const pnJid = WhatsAppJid.normalize(entry.phoneNumber);
      const phoneNumber = WhatsAppJid.toPhoneNumber(entry.phoneNumber);

      if (!pnJid || !phoneNumber) {
        this.logger.warn('Skipping invalid access control entry during seeding', undefined, { entry });
        continue;
      }

      await this.db
        .insert(users)
        .values({
          phoneNumber,
          pnJid,
          lidJid: null,
          name: entry.name || null,
          role: 'admin',
          status: 'active',
        })
        .onConflictDoNothing({ target: users.phoneNumber });
    }
  }

  /**
   * Returns count of active authorized users in PostgreSQL.
   */
  async countActiveUsers(): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.status, 'active'));

    return result[0]?.count ?? 0;
  }

  /**
   * Persists a newly observed companion LIDJID for an active user.
   */
  private async cacheLidJid(phoneNumber: string, lidJid: string): Promise<void> {
    await this.db
      .update(users)
      .set({ lidJid, updatedAt: new Date() })
      .where(eq(users.phoneNumber, phoneNumber));
  }
}
