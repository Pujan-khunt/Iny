export interface AllowedUserRecord {
  phoneNumber: string;
  jid: string;
  lid: string | null;
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
   * Authenticates the given address (phone, PNJID, or LID) and verifies the user is active.
   * If an incoming paired LID is provided and not yet cached for an active user, saves the LID.
   * Returns the AllowedUserRecord if authenticated and active, otherwise null.
   */
  authenticate(address: string, pairedLid?: string | null): Promise<AllowedUserRecord | null>;

  /**
   * Retrieves the full record for an allowed user by phone, JID, or LID.
   */
  getUser(address: string): Promise<AllowedUserRecord | null>;
}

/**
 * Port for administrative allowlist management (startup seeding and health checks).
 */
export interface AllowlistAdminPort {
  /**
   * Seeds initial users into PostgreSQL with ON CONFLICT (phone_number) DO NOTHING.
   */
  seedUsers(entries: string[]): Promise<void>;

  /**
   * Returns count of active authorized users in PostgreSQL.
   */
  countActiveUsers(): Promise<number>;
}
