import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: [
    './src/adapters/outbound/chat-repository/postgres/schema.ts',
    './src/adapters/outbound/whatsapp/postgres/schema.ts',
    './src/adapters/outbound/access-control/postgres/schema.ts',
  ],
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/iny',
  },
});
