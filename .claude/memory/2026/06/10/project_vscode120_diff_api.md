---
name: vscode-120-diff-api-evaluation
description: VS Code 1.120 getTextDiff proposed API — evaluated, not adopting
metadata:
  type: project
---

# VS Code 1.120 Document Diff API — Evaluated, Not Adopting

## Decision

Rejected adoption of `vscode.workspace.getTextDiff()` (proposed API) for this project.

## Why

- **Proposed API** — requires `enable-proposed-api` in package.json, cannot ship in published extensions
- **Wrong use case** — this project does inline edit review via `vscode.diff` command, not custom diff editor
- **Current approach sufficient** — `WorkspaceEdit.replace()` + `vscode.diff` is stable and works

## Future

When the API stabilizes, could use `getTextDiff` for minimal-edit mode (apply only changed lines instead of full replacement). Not worth pursuing until then.
