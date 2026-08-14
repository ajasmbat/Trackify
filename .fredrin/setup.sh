#!/usr/bin/env sh
# Runs once per new ticket worktree. Idempotent.
set -eu

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  # Give this worktree its own credential key so encrypted rows from other
  # worktrees do not collide.
  KEY_HEX=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
  # Portable sed -i for both GNU and BSD (macOS)
  if sed --version >/dev/null 2>&1; then
    sed -i "s/^CREDENTIAL_KEY_HEX=.*/CREDENTIAL_KEY_HEX=${KEY_HEX}/" .env
  else
    sed -i '' "s/^CREDENTIAL_KEY_HEX=.*/CREDENTIAL_KEY_HEX=${KEY_HEX}/" .env
  fi
fi

if command -v pnpm >/dev/null 2>&1; then
  pnpm install --prefer-offline
else
  echo "warn: pnpm not on PATH; skipping install"
fi
