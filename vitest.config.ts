import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/index.ts",
        "src/socket.ts",
        "src/web/**",
        "src/handlers/connection.ts",
        "src/handlers/groups.ts",
        "src/repositories/authState.ts",
      ],
    },
  },
});
