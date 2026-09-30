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

export interface AllowlistPort {
  /**
   * Checks whether the given address (phone, PNJID, or LIDJID) is authorized.
   * If an incoming LID is provided and not yet cached for the user, schedules a background update.
   */
  isAllowed(address: string, pairedLid?: string | null): Promise<boolean>;

  /**
   * Retrieves the full record for an allowed user by phone, JID, or LID.
   */
  getUser(address: string): Promise<AllowedUserRecord | null>;

  /**
   * Seeds initial users into PostgreSQL with ON CONFLICT (phone_number) DO NOTHING.
   */
  seedUsers(entries: string[]): Promise<void>;

  /**
   * Returns count of active authorized users in PostgreSQL.
   */
  countActiveUsers(): Promise<number>;

  /**
   * Caches an LID for an existing user record.
   */
  cacheLid(phoneNumber: string, lid: string): Promise<void>;
}
