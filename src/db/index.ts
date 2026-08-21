import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { DATABASE_URL } from "../config.js";

export const pool = new Pool({ connectionString: DATABASE_URL });

export const db = drizzlePg(pool);

export async function initDb(): Promise<void> {
  await migrate(db, { migrationsFolder: "./drizzle" });
}