import readline from 'node:readline/promises';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { loadConfig } from '../src/config.js';
import { PinoLoggerAdapter } from '../src/adapters/outbound/logger/PinoLoggerAdapter.js';
import { PostgresMessStagingRepository } from '../src/adapters/outbound/mess/postgres/PostgresMessStagingRepository.js';
import * as messSchema from '../src/adapters/outbound/mess/postgres/schema.js';

export interface ResetMessIo {
  print?: (message: string) => void;
  prompt?: (query: string) => Promise<string>;
}

export interface ExecuteResetWithGuardsOptions {
  nodeEnv?: string;
  databaseUrl?: string;
  confirmNameInput?: string;
  stagingRepo?: { atomicReset: () => Promise<void> } | any;
  io?: ResetMessIo;
}

/**
 * Executes a destructive reset of operational mess tables and staged messages
 * protected by 3 production safety guards:
 * 1. Environment Gate: Refuses to execute if NODE_ENV is production.
 * 2. Host Inspection: Parses DATABASE_URL and displays target host and database name.
 * 3. Explicit Name Challenge: Requires confirmation input strictly matching the database name.
 */
export async function executeResetWithGuards(
  options: ExecuteResetWithGuardsOptions
): Promise<void> {
  // Guard 1: Environment Gate
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  if (nodeEnv?.trim().toLowerCase() === 'production') {
    throw new Error('Refusing to run destructive reset in production environment.');
  }

  // Guard 2: Host Inspection & Target DB Display
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to perform reset.');
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(`Invalid database URL: "${databaseUrl}"`);
  }

  const dbName = parsed.pathname.replace(/^\//, '').split('?')[0];
  if (!dbName) {
    throw new Error(`Unable to extract database name from URL: "${databaseUrl}"`);
  }
  const host = parsed.host || parsed.hostname;

  options.io?.print?.(`⚠️ TARGET DATABASE: postgres://...@${host}/${dbName}`);

  // Guard 3: Explicit Name Challenge
  let confirmName = options.confirmNameInput;
  if (confirmName === undefined && options.io?.prompt) {
    const rawAnswer = await options.io.prompt(
      `Type the database name "${dbName}" to confirm wipe: `
    );
    confirmName = rawAnswer?.trim();
  }

  if (confirmName !== dbName) {
    throw new Error(
      `Confirmation name does not match target database name ("${dbName}"). Aborting reset.`
    );
  }

  // Execution: Atomic Reset
  if (options.stagingRepo) {
    await options.stagingRepo.atomicReset();
  }

  options.io?.print?.('Successfully reset all mess operational tables and staging messages.');
}

/**
 * Main interactive CLI entry point.
 */
export async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new PinoLoggerAdapter(config.LOG_LEVEL);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const sqlClient = postgres(config.DATABASE_URL, {
    max: 2,
    idle_timeout: 10,
    connect_timeout: 10,
  });

  try {
    const db = drizzle(sqlClient, {
      schema: messSchema,
    });
    const stagingRepo = new PostgresMessStagingRepository(db, logger);

    await executeResetWithGuards({
      nodeEnv: process.env.NODE_ENV,
      databaseUrl: config.DATABASE_URL,
      stagingRepo,
      io: {
        print: (s: string) => console.log(s),
        prompt: async (query: string) => rl.question(query),
      },
    });
  } finally {
    rl.close();
    await sqlClient.end();
  }
}

const isDirectExecution = (): boolean => {
  if (process.env.VITEST) return false;
  if (!process.argv[1]) return false;
  return (
    process.argv[1].endsWith('reset-mess.ts') ||
    process.argv[1].endsWith('reset-mess.js')
  );
};

if (isDirectExecution()) {
  main().catch((err) => {
    console.error('Fatal Reset Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
