import { defineConfig } from 'drizzle-kit';

try {
  process.loadEnvFile();
} catch {
  // Ignore if .env is missing or already loaded
}

export default defineConfig({
  schema: [
    './src/adapters/outbound/chat-repository/postgres/schema.ts',
    './src/adapters/outbound/whatsapp/postgres/schema.ts',
    './src/adapters/outbound/access-control/postgres/schema.ts',
  ],
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
