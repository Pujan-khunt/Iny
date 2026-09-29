import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { LoggerPort } from '../../../../core/ports/LoggerPort';

export async function runDatabaseMigrations(db: any, logger: LoggerPort): Promise<void> {
  logger.info('Applying database migrations...');
  try {
    await migrate(db, { migrationsFolder: './drizzle/migrations' });
    logger.info('Database migrations applied successfully');
  } catch (err) {
    logger.fatal('Failed to apply database migrations', err);
    throw err;
  }
}
