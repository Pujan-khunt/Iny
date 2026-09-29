import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runDatabaseMigrations } from '../../../../../src/adapters/outbound/chat-repository/postgres/migrator';
import { LoggerPort } from '../../../../../src/core/ports/LoggerPort';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

vi.mock('drizzle-orm/postgres-js/migrator', () => ({
  migrate: vi.fn(),
}));

describe('runDatabaseMigrations', () => {
  const mockLogger: LoggerPort = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };

  const mockDb = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully applies migrations and logs information', async () => {
    vi.mocked(migrate).mockResolvedValueOnce(undefined as never);

    await expect(runDatabaseMigrations(mockDb, mockLogger)).resolves.toBeUndefined();

    expect(mockLogger.info).toHaveBeenCalledWith('Applying database migrations...');
    expect(migrate).toHaveBeenCalledWith(mockDb, { migrationsFolder: './drizzle/migrations' });
    expect(mockLogger.info).toHaveBeenCalledWith('Database migrations applied successfully');
  });

  it('logs fatal error and rethrows when migration fails', async () => {
    const migrationError = new Error('Database connection failed during migration');
    vi.mocked(migrate).mockRejectedValueOnce(migrationError);

    await expect(runDatabaseMigrations(mockDb, mockLogger)).rejects.toThrow(migrationError);

    expect(mockLogger.info).toHaveBeenCalledWith('Applying database migrations...');
    expect(migrate).toHaveBeenCalledWith(mockDb, { migrationsFolder: './drizzle/migrations' });
    expect(mockLogger.fatal).toHaveBeenCalledWith('Failed to apply database migrations', migrationError);
  });
});
