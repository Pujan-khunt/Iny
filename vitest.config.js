const { defineConfig, configDefaults } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: true,
    exclude: [...configDefaults.exclude, 'dist/**', '.worktrees/**']
  },
});
