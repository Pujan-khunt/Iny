const { defineConfig, configDefaults } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: true,
    exclude: [...configDefaults.exclude, 'dist/**', '.worktrees/**'],
    fsModuleCache: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        'src/core/ports/**',
        'dist/**',
        '**/*.d.ts',
      ],
    },
  },
});
