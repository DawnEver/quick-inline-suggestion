---
name: project-tests
description: Test infrastructure setup for quick-inline-suggestion VS Code extension
metadata:
  node_type: memory
  type: project
  originSessionId: 4a75fab8-0995-47a0-87f1-a3004c0a880f
created: 2026-05-27
accessed: 2026-05-27
tier: short
---

Two-layer test setup added:

**Layer 1 — Unit tests (Vitest):** `src/test/utils.test.ts` covers pure functions extracted to `src/utils.ts` (`isQuestion`, `extractCodeBlock`, `sortedHistory`, `backendLabel`, `PROMPT_TEMPLATE`, `EXPLAIN_PROMPT`). Run with `npm run test:unit`. Fast, no VS Code needed.

**Layer 2 — Extension integration (@vscode/test-cli + Mocha):** `src/test/extension.test.ts` runs inside a real VS Code host to verify command registration. Config in `.vscode-test.mjs`. Run with `npm run test:ext`.

**Compile setup:** Main `tsconfig.json` excludes `src/test`. `tsconfig.test.json` compiles everything (including tests) to `dist/`. The `vscode-test` binary reads test files from `dist/test/`.

**Workflow (in CLAUDE.md):** `npm run test:unit && npm run test:ext && npm run package` must all succeed before reporting a task done.

**Why:** User wanted tests integrated into the Claude workflow so they run automatically after each feature.
