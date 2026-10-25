#!/usr/bin/env bash
set -eo pipefail

# Find staged .ts files (excluding deleted files)
STAGED_TS_FILES=$(git diff --cached --name-only --diff-filter=d | grep -E '\.ts$' || true)

if [ -z "$STAGED_TS_FILES" ]; then
	exit 0
fi

echo "Running pre-commit formatting check on staged TypeScript files..."
echo "$STAGED_TS_FILES" | xargs npx prettier --check

echo "Running pre-commit lint check on staged TypeScript files..."
echo "$STAGED_TS_FILES" | xargs npx eslint
