---
name: pre-commit-setup
description: Pre-commit hooks configured for format + type-check + tests; auto-installed via postinstall
metadata:
  node_type: memory
  type: project
  originSessionId: e0e4fcbe-f679-42c0-a169-667148f4fc6e
---

pre-commit hooks are configured in `.pre-commit-config.yaml` with two stages:

**pre-commit**: type-check (tsc), format (prettier), test-unit (vitest)
**pre-push**: test-ext (vscode integration tests)

Uses `yarn` as entry (not npx) because the project uses Yarn PnP v4.

**Why:** ESLint was removed — not installed and no config file. The `lint` script in package.json exists but won't run without eslint installed.

**How to apply:** `postinstall` script auto-installs hooks on `yarn install`. New contributors don't need to run `pre-commit install` manually. If `core.hooksPath` is set in git config, pre-commit will refuse — unset it locally first.
