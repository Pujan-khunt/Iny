import { defineConfig } from "drizzle-kit";

try {
	process.loadEnvFile();
} catch {
	// Ignore if .env is missing or already loaded
}

export default defineConfig({
	schema: [
		"./src/adapters/outbound/access-control/postgres/schema.ts",
		"./src/adapters/outbound/dialogue-turn-repository/postgres/schema.ts",
		"./src/adapters/outbound/whatsapp/postgres/schema.ts",
		"./src/adapters/outbound/mess/postgres/schema.ts",
	],
	out: "./drizzle/migrations",
	dialect: "postgresql",
	dbCredentials: {
		url: process.env.DATABASE_URL!,
	},
});
