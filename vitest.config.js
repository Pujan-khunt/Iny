const { defineConfig, configDefaults } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: true,
    fsModuleCache: true,
    exclude: [...configDefaults.exclude, 'dist/**', '.worktrees/**']
  },
});
