---
name: reentry-guard-removed
description: ReentryGuard was removed — Cmd+I now allows concurrent invocations across multiple editor windows
metadata:
  node_type: memory
  type: project
  originSessionId: b53b2194-291b-41e6-ac13-9a31c8898446
created: 2026-05-27
accessed: 2026-05-27
tier: short
---

ReentryGuard (boolean lock with tryAcquire/release wrapping the inlineEdit function) was removed. User's rationale: users may invoke Cmd+I in multiple editor windows simultaneously, and the guard incorrectly blocks that use case.

**Why:** The guard was designed to prevent double-trigger in the same window, but it was per-extension-singleton, so it also blocked legitimate multi-window usage.

**How to apply:** Do not re-add any global lock that prevents concurrent inlineEdit invocations. If a per-window or per-editor guard is needed later, scope it to that editor/document instance, not a global singleton.
