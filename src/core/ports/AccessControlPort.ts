export type UserRole = 'admin' | 'user';
export type UserStatus = 'active' | 'pending' | 'revoked' | 'suspended';

export interface UserRecord {
  phoneNumber: string;
  pnJid: string;
  lidJid: string | null;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Port for runtime access control and identity authentication.
 */
export interface AccessControlPort {
  /**
   * Authenticates the given address (phone number, PNJID, or LIDJID) and verifies the user is active.
   * If a companion LIDJID is provided and not yet cached for an active user, persists the LIDJID.
   * Returns the UserRecord if authenticated and active, otherwise null.
   */
  authenticate(address: string, companionLidJid?: string | null): Promise<UserRecord | null>;

  /**
   * Retrieves the full user record by phone number, PNJID, or LIDJID regardless of status.
   */
  getUser(address: string): Promise<UserRecord | null>;
}

export interface SeedUserEntry {
  phoneNumber: string;
  name?: string | null;
}

/**
 * Port for administrative user management (startup seeding and health checks).
 */
export interface AccessControlAdminPort {
  /**
   * Seeds initial users into PostgreSQL with ON CONFLICT (phone_number) DO NOTHING.
   * Seeded users default to status: 'active' and role: 'admin'.
   */
  seedUsers(entries: SeedUserEntry[]): Promise<void>;

  /**
   * Returns count of active authorized users in PostgreSQL.
   */
  countActiveUsers(): Promise<number>;
}
