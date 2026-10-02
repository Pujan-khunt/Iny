export interface AllowedUserRecord {
  phoneNumber: string;
  pnJid: string;
  lidJid: string | null;
  name: string | null;
  role: 'admin' | 'user';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Port for runtime access control and identity authentication.
 */
export interface AllowlistPort {
  /**
   * Authenticates the given address (phone, PNJID, or LIDJID) and verifies the user is active.
   * If an incoming paired LIDJID is provided and not yet cached for an active user, saves the LIDJID.
   * Returns the AllowedUserRecord if authenticated and active, otherwise null.
   */
  authenticate(address: string, pairedLidJid?: string | null): Promise<AllowedUserRecord | null>;

  /**
   * Retrieves the full record for an allowed user by phone, PNJID, or LIDJID.
   */
  getAllowedUser(address: string): Promise<AllowedUserRecord | null>;
}

export interface SeedUserEntry {
  phoneNumber: string;
  name?: string | null;
}

/**
 * Port for administrative allowlist management (startup seeding and health checks).
 */
export interface AllowlistAdminPort {
  /**
   * Seeds initial users into PostgreSQL with ON CONFLICT (phone_number) DO NOTHING.
   */
  seedUsers(entries: SeedUserEntry[]): Promise<void>;

  /**
   * Returns count of active authorized users in PostgreSQL.
   */
  countActiveUsers(): Promise<number>;
}
